/**
 * src/audio-manager.js – Preload + play HTMLAudio theo (modelId, soundKey).
 *
 * Đơn giản: 1 instance Audio per (model, key). Nếu nhiều tap dồn dập:
 * stop → reset currentTime → play (không tạo Audio mới mỗi lần).
 */
export class AudioManager {
  constructor() {
    /** @type {Map<string, HTMLAudioElement>} key = "modelId:soundKey" */
    this._sounds = new Map();
    this._unlocked = false;
  }

  /**
   * Preload âm thanh cho 1 model.
   * @param {string} modelId
   * @param {Object<string, string>} audioMap  { roar: "url", ... }
   */
  preload(modelId, audioMap) {
    if (!audioMap) return;
    for (const [key, url] of Object.entries(audioMap)) {
      if (!url) continue;
      const a = new Audio(url);
      a.preload = "auto";
      a.crossOrigin = "anonymous";
      this._sounds.set(`${modelId}:${key}`, a);
    }
  }

  /**
   * iOS yêu cầu 1 lần play() từ user gesture trước khi audio play được.
   * Gọi lần đầu user tap.
   */
  unlock() {
    if (this._unlocked) return;
    for (const a of this._sounds.values()) {
      a.muted = true;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
       .catch(() => { a.muted = false; });
    }
    this._unlocked = true;
  }

  /** Phát âm thanh từ đầu */
  play(modelId, key = "roar") {
    const a = this._sounds.get(`${modelId}:${key}`);
    if (!a) return false;
    try {
      a.pause();
      a.currentTime = 0;
      a.play().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}

export default AudioManager;
