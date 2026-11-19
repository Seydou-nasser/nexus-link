export const EVENT_MOUSE_MOVE = 0x01;
export const EVENT_MOUSE_BUTTON = 0x02;
export const EVENT_MOUSE_WHEEL = 0x03;
export const EVENT_KEY_EVENT = 0x04;
export const FLAG_RELATIVE = 0x00;
export const FLAG_ABSOLUTE = 0x01;

export function mapDomKeyToVirtualKey(
  key: string
): { vk: number; shift: boolean } | null {
  if (key === "Backspace") return { vk: 0x08, shift: false };
  if (key === "Enter") return { vk: 0x0d, shift: false };
  if (key === " ") return { vk: 0x20, shift: false };

  if (key.length === 1) {
    const code = key.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return { vk: code - 32, shift: false };
    }
    if (code >= 65 && code <= 90) {
      return { vk: code, shift: true };
    }
    if (code >= 48 && code <= 57) {
      return { vk: code, shift: false };
    }
    const punct: Record<string, { vk: number; shift: boolean }> = {
      ".": { vk: 0xbe, shift: false },
      ">": { vk: 0xbe, shift: true },
      ",": { vk: 0xbc, shift: false },
      "<": { vk: 0xbc, shift: true },
      "/": { vk: 0xbf, shift: false },
      "?": { vk: 0xbf, shift: true },
      ";": { vk: 0xba, shift: false },
      ":": { vk: 0xba, shift: true },
      "-": { vk: 0xbd, shift: false },
      _: { vk: 0xbd, shift: true },
      "=": { vk: 0xbb, shift: false },
      "+": { vk: 0xbb, shift: true },
      "!": { vk: 0x31, shift: true },
      "@": { vk: 0x32, shift: true },
      "#": { vk: 0x33, shift: true },
      $: { vk: 0x34, shift: true },
      "%": { vk: 0x35, shift: true },
      "^": { vk: 0x36, shift: true },
      "&": { vk: 0x37, shift: true },
      "*": { vk: 0x38, shift: true },
      "(": { vk: 0x39, shift: true },
      ")": { vk: 0x30, shift: true },
    };
    return punct[key] ?? null;
  }

  return null;
}
