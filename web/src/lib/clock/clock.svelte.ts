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
  // A plain number, not a SvelteDate: this store outlives the components that
  // read it, and SvelteDate's per-getter deriveds go stale when the component
  // that first read them (the Setup screen's clock) is destroyed.
  #nowMs = $state(Date.now());

  /** The browser's current time; formatted in the browser's own time zone. */
  get now(): Date {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a fresh read-only snapshot; reactivity comes from #nowMs
    return new Date(this.#nowMs);
  }

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
      const t = Date.now(); // a local, so a caller's $effect does not subscribe to #nowMs
      this.#nowMs = t;
      clearTimeout(timeout);
      timeout = setTimeout(tick, 60_000 - (t % 60_000) + 20);
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
