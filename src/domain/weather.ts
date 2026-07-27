import type { WeatherState } from '@/types';

// ---------------------------------------------------------------------------
// Weather hooks.
//
// The platform exposes a WeatherProvider interface so a live source (NOAA /
// tides / marine forecast API) can be plugged in later. For the MVP we ship a
// deterministic synthetic provider (no network) that varies conditions over the
// day — enough to drive ops advisories and the command-center weather widget.
// ---------------------------------------------------------------------------

export interface WeatherProvider {
  at(time: Date): WeatherState;
  name: string;
}

/** Deterministic pseudo-random in [0,1) from an integer seed. */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export const SyntheticWeatherProvider: WeatherProvider = {
  name: 'Synthetic (Houston Ship Channel)',
  at(time: Date): WeatherState {
    const hour = time.getHours() + time.getMinutes() / 60;
    const dayIndex = Math.floor(time.getTime() / 86_400_000);
    // Diurnal wind pattern peaking mid-afternoon, plus a per-day baseline.
    const base = 6 + seeded(dayIndex) * 10;
    const diurnal = Math.max(0, Math.sin((hour - 6) / 24 * Math.PI * 2)) * 12;
    const windKts = Math.round((base + diurnal) * 10) / 10;
    const gustKts = Math.round((windKts * (1.3 + seeded(dayIndex + 7) * 0.4)) * 10) / 10;
    const waveFt = Math.round((0.5 + windKts / 12) * 10) / 10;
    const visibilityNm = Math.round((10 - seeded(dayIndex + 3) * 6) * 10) / 10;

    let condition: WeatherState['condition'] = 'calm';
    let advisory: string | null = null;
    if (windKts >= 25 || gustKts >= 33) {
      condition = 'rough';
      advisory = 'High winds — suspend transfers; hold barges alongside.';
    } else if (windKts >= 18) {
      condition = 'moderate';
      advisory = 'Fresh breeze — monitor mooring & fender loads during transfer.';
    } else if (visibilityNm < 1.5) {
      condition = 'restricted';
      advisory = 'Reduced visibility — channel transits may be delayed by VTS.';
    }

    return {
      at: time.toISOString(),
      windKts,
      gustKts,
      waveFt,
      visibilityNm,
      condition,
      advisory,
    };
  },
};

/** Default provider used by the app; swap here to integrate a live source. */
export const weatherProvider: WeatherProvider = SyntheticWeatherProvider;
