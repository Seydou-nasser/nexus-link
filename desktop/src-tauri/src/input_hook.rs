use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::network::{NetworkState, emit_status_update};
use crate::protocol::{InputFocusStatePayload, InputSettings};
use crate::udp_input::{
    EVENT_KEY_EVENT, EVENT_MOUSE_BUTTON, EVENT_MOUSE_MOVE, EVENT_MOUSE_WHEEL, FLAG_RELATIVE,
    UdpInputSender,
};

enum HookCommand {
    EnterAndroid {
        edge: String,
        normalized_pos: f64,
        restore_x: i32,
        restore_y: i32,
        center_x: i32,
        center_y: i32,
    },
    ExitAndroid {
        notify_android: bool,
    },
    UdpEvent {
        event_type: u8,
        dx_or_code: i16,
        dy_or_mods: i16,
        button_state: u8,
        flags: u8,
    },
    RecenterCursor {
        center_x: i32,
        center_y: i32,
    },
}

#[derive(Clone)]
struct HookConfigSnapshot {
    settings: InputSettings,
    has_device: bool,
}

pub struct InputHookRuntime {
    network_state: Arc<Mutex<NetworkState>>,
    app_handle: AppHandle,
    cmd_tx: Sender<HookCommand>,
    config_snapshot: Mutex<HookConfigSnapshot>,
    focus_active: AtomicBool,
    button_mask: AtomicU8,
    center_x: AtomicI32,
    center_y: AtomicI32,
    ignore_until_ms: AtomicU64,
    suppress_edge_until_ms: AtomicU64,
    edge_enter_since_ms: AtomicU64,
    saved_restore: Mutex<(i32, i32, String)>,
    epoch: Instant,
}

static HOOK_RUNTIME: OnceLock<Arc<InputHookRuntime>> = OnceLock::new();

impl InputHookRuntime {
    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    pub fn is_focus_on_android(&self) -> bool {
        self.focus_active.load(Ordering::Acquire)
    }

    /// Met à jour le snapshot léger lu par le hook bas niveau sans bloquer sur NetworkState.
    pub fn refresh_snapshot(&self) {
        let (settings, has_device) = {
            let guard = self.network_state.lock().unwrap();
            (
                guard.input_settings.clone(),
                guard.connected_device.is_some(),
            )
        };
        if let Ok(mut snap) = self.config_snapshot.try_lock() {
            snap.settings = settings;
            snap.has_device = has_device;
        }
    }

    pub fn set_focus_from_remote(&self, active_target: &str) {
        if active_target.eq_ignore_ascii_case("PC")
            && self.focus_active.swap(false, Ordering::AcqRel)
        {
            self.button_mask.store(0, Ordering::Relaxed);
            self.suppress_edge_until_ms
                .store(self.now_ms() + 350, Ordering::Relaxed);
            let _ = self.cmd_tx.send(HookCommand::ExitAndroid {
                notify_android: false,
            });
        }
    }

    fn request_enter_android(
        &self,
        edge: String,
        normalized_pos: f64,
        cursor_x: i32,
        cursor_y: i32,
        center_x: i32,
        center_y: i32,
    ) {
        self.center_x.store(center_x, Ordering::Relaxed);
        self.center_y.store(center_y, Ordering::Relaxed);
        self.button_mask.store(0, Ordering::Relaxed);
        self.edge_enter_since_ms.store(0, Ordering::Relaxed);
        self.ignore_until_ms
            .store(self.now_ms() + 75, Ordering::Relaxed);
        self.focus_active.store(true, Ordering::Release);

        let _ = self.cmd_tx.send(HookCommand::EnterAndroid {
            edge,
            normalized_pos,
            restore_x: cursor_x,
            restore_y: cursor_y,
            center_x,
            center_y,
        });
    }

    fn request_exit_android(&self, notify_android: bool) {
        if !self.focus_active.swap(false, Ordering::AcqRel) {
            return;
        }
        self.button_mask.store(0, Ordering::Relaxed);
        self.edge_enter_since_ms.store(0, Ordering::Relaxed);
        self.suppress_edge_until_ms
            .store(self.now_ms() + 350, Ordering::Relaxed);
        let _ = self
            .cmd_tx
            .send(HookCommand::ExitAndroid { notify_android });
    }
}

/// Démarre le worker réseau/Win32 et les hooks souris/clavier non-bloquants.
pub fn start_input_hook_monitor(state: Arc<Mutex<NetworkState>>, app_handle: AppHandle) {
    let udp_sender = match UdpInputSender::new() {
        Ok(sender) => sender,
        Err(err) => {
            eprintln!(
                "[NexusLink] Impossible d'initialiser le socket UDP : {}",
                err
            );
            return;
        }
    };

    let (cmd_tx, cmd_rx) = mpsc::channel::<HookCommand>();
    let runtime = Arc::new(InputHookRuntime {
        network_state: state,
        app_handle,
        cmd_tx,
        config_snapshot: Mutex::new(HookConfigSnapshot {
            settings: InputSettings::default(),
            has_device: false,
        }),
        focus_active: AtomicBool::new(false),
        button_mask: AtomicU8::new(0),
        center_x: AtomicI32::new(0),
        center_y: AtomicI32::new(0),
        ignore_until_ms: AtomicU64::new(0),
        suppress_edge_until_ms: AtomicU64::new(0),
        edge_enter_since_ms: AtomicU64::new(0),
        saved_restore: Mutex::new((0, 0, "RIGHT".to_string())),
        epoch: Instant::now(),
    });

    if HOOK_RUNTIME.set(Arc::clone(&runtime)).is_err() {
        return;
    }

    let worker_runtime = Arc::clone(&runtime);
    std::thread::spawn(move || {
        run_worker_loop(worker_runtime, udp_sender, cmd_rx);
    });

    #[cfg(target_os = "windows")]
    std::thread::spawn(move || {
        windows_impl::run_hook_loop();
    });
}

/// Informe le moniteur que l'état de connexion ou les paramètres d'entrée ont changé.
pub fn sync_runtime_snapshot() {
    if let Some(runtime) = HOOK_RUNTIME.get() {
        runtime.refresh_snapshot();
    }
}

/// Informe le moniteur qu'Android a demandé le retour du focus vers le PC ou s'est déconnecté.
pub fn handle_remote_focus_state(active_target: &str) {
    if let Some(runtime) = HOOK_RUNTIME.get() {
        runtime.set_focus_from_remote(active_target);
        runtime.refresh_snapshot();
    }
}

fn run_worker_loop(
    runtime: Arc<InputHookRuntime>,
    udp_sender: UdpInputSender,
    cmd_rx: mpsc::Receiver<HookCommand>,
) {
    #[cfg(target_os = "windows")]
    unsafe {
        windows_sys::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(
            windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }

    let mut snap_tick = 0u32;
    let mut cached_udp_target: Option<(String, u16, String)> = None;

    loop {
        match cmd_rx.recv_timeout(Duration::from_millis(25)) {
            Ok(cmd) => process_worker_command(&runtime, &udp_sender, &mut cached_udp_target, cmd),
            Err(RecvTimeoutError::Timeout) => {
                snap_tick = snap_tick.wrapping_add(1);
                if snap_tick % 10 == 0 {
                    runtime.refresh_snapshot();
                    let guard = runtime.network_state.lock().unwrap();
                    cached_udp_target = guard.get_active_udp_target();
                }

                // Filet de sécurité si une fenêtre élevée (UIPI) bloque WH_KEYBOARD_LL :
                // l'appui sur Échap ramène toujours le curseur sur le PC.
                #[cfg(target_os = "windows")]
                if runtime.is_focus_on_android() {
                    let esc_down = unsafe {
                        windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(
                            windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE as i32,
                        ) < 0
                    };
                    if esc_down {
                        runtime.request_exit_android(true);
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn process_worker_command(
    runtime: &Arc<InputHookRuntime>,
    udp_sender: &UdpInputSender,
    cached_udp_target: &mut Option<(String, u16, String)>,
    cmd: HookCommand,
) {
    match cmd {
        HookCommand::EnterAndroid {
            edge,
            normalized_pos,
            restore_x,
            restore_y,
            center_x,
            center_y,
        } => {
            if let Ok(mut saved) = runtime.saved_restore.lock() {
                *saved = (restore_x, restore_y, edge.clone());
            }

            #[cfg(target_os = "windows")]
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(center_x, center_y);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (center_x, center_y);

            {
                let mut guard = runtime.network_state.lock().unwrap();
                *cached_udp_target = guard.get_active_udp_target();
                guard.input_active_target = "ANDROID".to_string();
                let payload = InputFocusStatePayload {
                    active_target: "ANDROID".to_string(),
                    entry_edge: Some(edge),
                    normalized_position: Some(normalized_pos.clamp(0.0, 1.0)),
                };
                if let Ok(json_val) = serde_json::to_value(payload) {
                    guard.send_ws_message("INPUT_FOCUS_STATE", json_val);
                }
            }
            emit_status_update(&runtime.network_state, &runtime.app_handle);
        }

        HookCommand::ExitAndroid { notify_android } => {
            *cached_udp_target = None;
            let (restore_x, restore_y, active_edge) = runtime
                .saved_restore
                .lock()
                .map(|g| g.clone())
                .unwrap_or((400, 400, "RIGHT".to_string()));

            let (nudged_x, nudged_y) = match active_edge.as_str() {
                "LEFT" => (restore_x + 36, restore_y),
                "BOTTOM" => (restore_x, restore_y - 36),
                _ => (restore_x - 36, restore_y),
            };

            #[cfg(target_os = "windows")]
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(nudged_x, nudged_y);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (nudged_x, nudged_y);

            {
                let mut guard = runtime.network_state.lock().unwrap();
                guard.input_active_target = "PC".to_string();
                if notify_android {
                    let payload = InputFocusStatePayload {
                        active_target: "PC".to_string(),
                        entry_edge: None,
                        normalized_position: None,
                    };
                    if let Ok(json_val) = serde_json::to_value(payload) {
                        guard.send_ws_message("INPUT_FOCUS_STATE", json_val);
                    }
                }
            }
            emit_status_update(&runtime.network_state, &runtime.app_handle);
        }

        HookCommand::RecenterCursor { center_x, center_y } => {
            #[cfg(target_os = "windows")]
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos(center_x, center_y);
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (center_x, center_y);
        }

        HookCommand::UdpEvent {
            event_type,
            dx_or_code,
            dy_or_mods,
            button_state,
            flags,
        } => {
            if cached_udp_target.is_none() {
                let guard = runtime.network_state.lock().unwrap();
                *cached_udp_target = guard.get_active_udp_target();
            }
            if let Some((ip, port, secret)) = cached_udp_target.as_ref() {
                udp_sender.send_event(
                    ip,
                    *port,
                    secret,
                    event_type,
                    dx_or_code,
                    dy_or_mods,
                    button_state,
                    flags,
                );
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::HiDpi::{
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetThreadDpiAwarenessContext,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_MENU, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, GetSystemMetrics, HC_ACTION,
        KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN,
        WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN,
        WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    const LLMHF_INJECTED_FLAG: u32 = 0x01;

    pub fn run_hook_loop() {
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

            let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), null_mut(), 0);
            let keyboard_hook =
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), null_mut(), 0);

            if mouse_hook.is_null() || keyboard_hook.is_null() {
                eprintln!("[NexusLink] Échec d'installation d'un hook Win32");
            }

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            if !mouse_hook.is_null() {
                UnhookWindowsHookEx(mouse_hook);
            }
            if !keyboard_hook.is_null() {
                UnhookWindowsHookEx(keyboard_hook);
            }
        }
    }

    unsafe extern "system" fn mouse_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code != HC_ACTION as i32 {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        }

        let Some(runtime) = HOOK_RUNTIME.get() else {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        };

        let ms = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
        let msg = wparam as u32;

        // Laisse passer les événements injectés par SetCursorPos
        if (ms.flags & LLMHF_INJECTED_FLAG) != 0 {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        }

        if runtime.is_focus_on_android() {
            match msg {
                WM_MOUSEMOVE => {
                    let now = runtime.now_ms();
                    if now < runtime.ignore_until_ms.load(Ordering::Relaxed) {
                        return 1;
                    }

                    let cx = runtime.center_x.load(Ordering::Relaxed);
                    let cy = runtime.center_y.load(Ordering::Relaxed);
                    let raw_dx = ms.pt.x - cx;
                    let raw_dy = ms.pt.y - cy;

                    // Ignore un éventuel saut initial avant que SetCursorPos ait recentré le curseur
                    if raw_dx.abs() > 380 || raw_dy.abs() > 380 {
                        let _ = runtime.cmd_tx.send(HookCommand::RecenterCursor {
                            center_x: cx,
                            center_y: cy,
                        });
                        return 1;
                    }

                    if raw_dx != 0 || raw_dy != 0 {
                        let buttons = runtime.button_mask.load(Ordering::Relaxed);
                        let _ = runtime.cmd_tx.send(HookCommand::UdpEvent {
                            event_type: EVENT_MOUSE_MOVE,
                            dx_or_code: raw_dx as i16,
                            dy_or_mods: raw_dy as i16,
                            button_state: buttons,
                            flags: FLAG_RELATIVE,
                        });
                    }
                    return 1;
                }
                WM_LBUTTONDOWN | WM_LBUTTONUP | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN
                | WM_MBUTTONUP => {
                    let mut mask = runtime.button_mask.load(Ordering::Relaxed);
                    match msg {
                        WM_LBUTTONDOWN => mask |= 0x01,
                        WM_LBUTTONUP => mask &= !0x01,
                        WM_RBUTTONDOWN => mask |= 0x02,
                        WM_RBUTTONUP => mask &= !0x02,
                        WM_MBUTTONDOWN => mask |= 0x04,
                        WM_MBUTTONUP => mask &= !0x04,
                        _ => {}
                    }
                    runtime.button_mask.store(mask, Ordering::Relaxed);
                    let _ = runtime.cmd_tx.send(HookCommand::UdpEvent {
                        event_type: EVENT_MOUSE_BUTTON,
                        dx_or_code: 0,
                        dy_or_mods: 0,
                        button_state: mask,
                        flags: FLAG_RELATIVE,
                    });
                    return 1;
                }
                WM_MOUSEWHEEL => {
                    let wheel_raw = ((ms.mouseData >> 16) as u16) as i16;
                    let steps = (wheel_raw / 120).clamp(-127, 127);
                    let delta = if steps == 0 && wheel_raw != 0 {
                        if wheel_raw > 0 { 1 } else { -1 }
                    } else {
                        steps
                    };
                    let buttons = runtime.button_mask.load(Ordering::Relaxed);
                    let _ = runtime.cmd_tx.send(HookCommand::UdpEvent {
                        event_type: EVENT_MOUSE_WHEEL,
                        dx_or_code: 0,
                        dy_or_mods: delta,
                        button_state: buttons,
                        flags: FLAG_RELATIVE,
                    });
                    return 1;
                }
                _ => return 1,
            }
        }

        // Mode PC : lecture non-bloquante du snapshot pour détecter le bord
        if msg == WM_MOUSEMOVE {
            if let Ok(snap) = runtime.config_snapshot.try_lock() {
                if snap.settings.enabled && snap.has_device {
                    let edge = snap.settings.edge.clone();
                    let resistance_ms = snap.settings.edge_resistance_ms;
                    let require_ctrl = snap.settings.require_ctrl;
                    drop(snap);

                    let (virt_left, virt_top, virt_w, virt_h) = unsafe {
                        (
                            GetSystemMetrics(SM_XVIRTUALSCREEN),
                            GetSystemMetrics(SM_YVIRTUALSCREEN),
                            GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1),
                            GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1),
                        )
                    };
                    let virt_right = virt_left + virt_w;
                    let virt_bottom = virt_top + virt_h;

                    let at_edge = match edge.as_str() {
                        "LEFT" => ms.pt.x <= virt_left + 1,
                        "BOTTOM" => ms.pt.y >= virt_bottom - 2,
                        _ => ms.pt.x >= virt_right - 2,
                    };

                    let ctrl_ok =
                        !require_ctrl || unsafe { GetAsyncKeyState(VK_CONTROL as i32) < 0 };

                    let now = runtime.now_ms();
                    if at_edge && ctrl_ok {
                        if now >= runtime.suppress_edge_until_ms.load(Ordering::Relaxed) {
                            let enter_since = runtime.edge_enter_since_ms.load(Ordering::Relaxed);
                            let start_ms = if enter_since == 0 {
                                runtime
                                    .edge_enter_since_ms
                                    .store(now.max(1), Ordering::Relaxed);
                                now
                            } else {
                                enter_since
                            };

                            if now.saturating_sub(start_ms) >= resistance_ms {
                                let normalized = match edge.as_str() {
                                    "BOTTOM" => (ms.pt.x - virt_left) as f64 / virt_w as f64,
                                    _ => (ms.pt.y - virt_top) as f64 / virt_h as f64,
                                };
                                let center_x = virt_left + virt_w / 2;
                                let center_y = virt_top + virt_h / 2;
                                runtime.request_enter_android(
                                    edge, normalized, ms.pt.x, ms.pt.y, center_x, center_y,
                                );
                                return 1;
                            }
                        }
                    } else {
                        runtime.edge_enter_since_ms.store(0, Ordering::Relaxed);
                    }
                }
            }
        }

        unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
    }

    unsafe extern "system" fn keyboard_hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code != HC_ACTION as i32 {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        }

        let Some(runtime) = HOOK_RUNTIME.get() else {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        };

        if !runtime.is_focus_on_android() {
            return unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) };
        }

        let kb = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        let msg = wparam as u32;
        let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;

        if !is_down && !is_up {
            return 1;
        }

        // Touche Échap : retour immédiat de la souris et du clavier sur le PC
        if is_down && kb.vkCode == VK_ESCAPE as u32 {
            runtime.request_exit_android(true);
            return 1;
        }

        let mut mods: i16 = 0;
        unsafe {
            if GetAsyncKeyState(VK_CONTROL as i32) < 0 {
                mods |= 0x01;
            }
            if GetAsyncKeyState(VK_SHIFT as i32) < 0 {
                mods |= 0x02;
            }
            if GetAsyncKeyState(VK_MENU as i32) < 0 {
                mods |= 0x04;
            }
        }

        let _ = runtime.cmd_tx.send(HookCommand::UdpEvent {
            event_type: EVENT_KEY_EVENT,
            dx_or_code: (kb.vkCode & 0xFFFF) as i16,
            dy_or_mods: mods,
            button_state: if is_down { 1 } else { 0 },
            flags: FLAG_RELATIVE,
        });
        1
    }
}
