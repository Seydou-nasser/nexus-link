use std::net::UdpSocket;
use std::sync::atomic::{AtomicU32, Ordering};

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

pub const UDP_MAGIC_BYTE: u8 = 0x4E;
pub const EVENT_MOUSE_MOVE: u8 = 0x01;
pub const EVENT_MOUSE_BUTTON: u8 = 0x02;
pub const EVENT_MOUSE_WHEEL: u8 = 0x03;
pub const EVENT_KEY_EVENT: u8 = 0x04;

pub const FLAG_RELATIVE: u8 = 0x00;
pub const FLAG_ABSOLUTE: u8 = 0x01;

/// Émetteur UDP haute fréquence (trames binaires de 16 octets Big-Endian)
/// conforme à `docs/protocol-spec.md`.
pub struct UdpInputSender {
    socket: UdpSocket,
    sequence: AtomicU32,
}

impl UdpInputSender {
    pub fn new() -> std::io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        socket.set_nonblocking(true)?;
        Ok(Self {
            socket,
            sequence: AtomicU32::new(0),
        })
    }

    /// Encode une trame de 16 octets Big-Endian authentifiée par HMAC-SHA256 tronqué (32 bits).
    pub fn encode_frame(
        &self,
        event_type: u8,
        dx_or_code: i16,
        dy_or_mods: i16,
        button_state: u8,
        flags: u8,
        session_secret: &str,
    ) -> [u8; 16] {
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        let mut frame = [0u8; 16];
        frame[0] = UDP_MAGIC_BYTE;
        frame[1] = event_type;
        frame[2..6].copy_from_slice(&seq.to_be_bytes());
        frame[6..8].copy_from_slice(&dx_or_code.to_be_bytes());
        frame[8..10].copy_from_slice(&dy_or_mods.to_be_bytes());
        frame[10] = button_state;
        frame[11] = flags;

        if let Ok(mut mac) = HmacSha256::new_from_slice(session_secret.as_bytes()) {
            mac.update(&frame[0..12]);
            let tag = mac.finalize().into_bytes();
            frame[12..16].copy_from_slice(&tag[0..4]);
        }

        frame
    }

    /// Envoie immédiatement un événement souris ou clavier vers l'appareil Android.
    #[allow(clippy::too_many_arguments)]
    pub fn send_event(
        &self,
        target_ip: &str,
        udp_port: u16,
        session_secret: &str,
        event_type: u8,
        dx_or_code: i16,
        dy_or_mods: i16,
        button_state: u8,
        flags: u8,
    ) {
        let frame = self.encode_frame(
            event_type,
            dx_or_code,
            dy_or_mods,
            button_state,
            flags,
            session_secret,
        );
        let _ = self.socket.send_to(&frame, (target_ip, udp_port));
    }
}
