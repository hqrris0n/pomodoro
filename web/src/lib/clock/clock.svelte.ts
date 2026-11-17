import { SvelteDate } from 'svelte/reactivity';
import { load, save } from '../storage';

export type ClockFormat = '12' | '24';

const pad = (n: number) => String(n).padStart(2, '0');

/** Hours and minutes with leading zeros; 12-hour mode adds AM/PM as a separate suffix. */
export function formatTime(
  date: Date,
  format: ClockFormat,
): { time: string; suffix: 'AM' | 'PM' | '' } {
  const h = date.getHours();
  const m = pad(date.getMinutes());
  if (format === '24') return { time: `${pad(h)}:${m}`, suffix: '' };
  return { time: `${pad(h % 12 || 12)}:${m}`, suffix: h < 12 ? 'AM' : 'PM' };
}

/** Local date and time to the minute, the form `<time datetime>` accepts. */
export function localDatetime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export class ClockStore {
  #show = $state(false);
  #format = $state<ClockFormat>('12');
  now = new SvelteDate();

  constructor() {
    const show = load<unknown>('clockShow', false);
    if (typeof show === 'boolean') this.#show = show;
    const format = load<unknown>('clockFormat', '12');
    if (format === '12' || format === '24') this.#format = format;
  }

  get show(): boolean {
    return this.#show;
  }

  set show(on: boolean) {
    this.#show = on;
    save('clockShow', on);
  }

  get format(): ClockFormat {
    return this.#format;
  }

  set format(f: ClockFormat) {
    if (f !== '12' && f !== '24') return;
    this.#format = f;
    save('clockFormat', f);
  }

  get formatted() {
    return formatTime(this.now, this.#format);
  }

  /** Keep `now` current at the start of each minute and when the tab becomes visible. Returns stop. */
  watch(): () => void {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      this.now.setTime(Date.now());
      clearTimeout(timeout);
      timeout = setTimeout(tick, 60_000 - (this.now.getTime() % 60_000) + 20);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}

export const clock = new ClockStore();
