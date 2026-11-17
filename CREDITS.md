# Sound credits

All loops in `web/public/sounds/` are CC0 or public domain, sourced from Wikimedia Commons.
Licences were read from each file's own Commons page. Every loop was processed with
`web/scripts/make-loop.sh`. "Public domain" entries are tagged `PD-author` on Commons
(author dedicated the work to the public domain; originally on PDSounds.org).

| Channel | Title | Author | Source page | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| chatter | Cafe ambiance | Marble Toast | https://commons.wikimedia.org/wiki/File:Cafe_ambiance.ogg | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | 60 s taken from 4:32, mono, crossfaded loop, re-encoded |
| espresso | Coffee Grinder (smijen) followed by espresso machine (hugh), joined with a 1 s crossfade | smijen; hugh | https://commons.wikimedia.org/wiki/File:Coffee_grinder.ogg ; https://commons.wikimedia.org/wiki/File:Espresso_machine.ogg | Public domain, PD-author (https://commons.wikimedia.org/wiki/Template:PD-author) | trimmed to 56 s, mono, crossfaded loop, re-encoded |
| dishes | Kitchen Tidy-up | starlite | https://commons.wikimedia.org/wiki/File:Kitchen_tidy_up.ogg | Public domain, PD-author (https://commons.wikimedia.org/wiki/Template:PD-author) | trimmed to 55 s (all the source has), mono, crossfaded loop, re-encoded |
| rain | Rain against the Window | cori | https://commons.wikimedia.org/wiki/File:Rain_against_the_window.ogg | Public domain, PD-author (https://commons.wikimedia.org/wiki/Template:PD-author) | trimmed to 60 s, mono, crossfaded loop, re-encoded |
| fireplace | Dry grass burning in open fireplace | ezwa | https://commons.wikimedia.org/wiki/File:Dry_grass_burning_in_open_fireplace.ogg | Public domain, PD-author (https://commons.wikimedia.org/wiki/Template:PD-author) | source is only 25 s: three passes joined with 1.5 s crossfades, then trimmed to 60 s, mono, crossfaded loop, re-encoded |
| street | First day of urban spring in Berlin (Greifswalder Str.) | qubodup | https://commons.wikimedia.org/wiki/File:184809_qubodup_first-day-of-urban-spring-in-berlin-2013-04-14.flac | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | 60 s taken from 0:40, mono, crossfaded loop, re-encoded |
| pages | Leafing through pages, flicking pages, shutting book | cori | https://commons.wikimedia.org/wiki/File:Old_book.ogg | Public domain, PD-author (https://commons.wikimedia.org/wiki/Template:PD-author) | trimmed to 60 s, mono, crossfaded loop, re-encoded (heavily limited to reach target loudness) |
| typing | 399603 dustin-davis typing | Dustin_Davis | https://commons.wikimedia.org/wiki/File:399603_dustin-davis_typing.wav | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | 60 s taken from 6:46, mono, crossfaded loop, re-encoded |
| wind | Howling wind | Tvabutzku1234 | https://commons.wikimedia.org/wiki/File:Howling_wind.ogg | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | 60 s taken from 0:24, mono, crossfaded loop, re-encoded |
| hum | Ambient Kitchen Sounds | Wilfredor | https://commons.wikimedia.org/wiki/File:Ambient_Kitchen_Sounds.wav | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | 60 s taken from 3:38, mono, crossfaded loop, re-encoded |

## Chime

`web/public/sounds/chime.mp3` is not a download. It was generated with ffmpeg (`aevalsrc`):
two sine notes (660 Hz, then 880 Hz from 0.3 s) with a 5 ms attack and exponential decay,
1.8 s long, peak about -6 dBFS. It is original work with no licence restrictions.

## Effects

`web/public/sounds/pop.mp3` is not a download. It was generated with ffmpeg (`aevalsrc`):
a sine whose pitch sweeps exponentially down from 900 Hz to 250 Hz (25 ms time constant),
a 3 ms attack and exponential decay (25 ms time constant), plus a tiny 2 ms noise click at
the start and a 10 ms fade to silence at the end. 110 ms long, mono, 32 kHz, peak about
-6 dBFS. It is original work with no licence restrictions.

`web/public/sounds/page.mp3` is a single page turn cut from the same recording as the
"pages" loop: "Leafing through pages, flicking pages, shutting book" by cori,
https://commons.wikimedia.org/wiki/File:Old_book.ogg , public domain (PD-author,
https://commons.wikimedia.org/wiki/Template:PD-author). Changes: 0.6 s taken from 1:02.70
(one isolated flip, quiet before and after), 150 Hz high-pass, 8 ms fade in, 60 ms fade out,
mono, 32 kHz, gain to a peak of about -6 dBFS, re-encoded as 64 kbps MP3.
