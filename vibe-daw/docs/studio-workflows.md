# Reusable sounds and writing workflows

## Your library

Use the sound browser's **Library** tab to search clips, sounds, effect profiles and project templates. Save selected clips from **Clips → Save selected clips to library** in the arrangement toolbar; save a track sound or effect chain from **Sound & FX**. Sample rows also have a bookmark. Templates save the whole arrangement and open as a new project, preserving the source.

Clips retain their notes/audio, sounds, effects and overlapping notes/lyrics. Loading a phrase creates fresh IDs and is undoable. Choose **Use selected track** to keep that track's existing sound while adding a phrase. Applying a saved sound replaces the selected track's instrument/kit/effects while keeping its clips. Effect profiles can append or explicitly replace a chain. External sidechain sources are disabled when their original track is absent.

Without an account, the library stays in this browser's IndexedDB. Signed-in libraries belong to that account and sync through Firestore; referenced audio uploads before its library record. **Copy device library** explicitly copies guest items into the current account. Changing accounts hides the previous account's records. Offline saves remain queued, failed syncs show a retry control, and deletion tombstones prevent offline devices reviving deleted items. Library changes are persistent and separate from project undo. Current presets are limited to 750 KB of project/sample metadata; audio is stored separately.

## Instructions for every chat

In **Settings → AI → Custom instructions**, enter up to 4,000 characters of style or workflow preferences. Both Agent and Ask use these preferences in new requests, including after a new chat. They sync with your account's AI preferences when signed in. Ask remains read-only.

## Timed notes and lyrics

Use the arrangement's **Notes & lyrics** row or the dock tab to add mix feedback, arrangement reminders and lyric cues. A selected time range supplies the cue's start and duration; otherwise it starts at the playhead. Cues can apply to the whole arrangement or a track, and work with no audio or vocal track. Click a cue to edit its text, kind, position and duration. Resolve completed production notes, or search/filter the full list in the dock.

The Producer can read and write these cues with annotation tools. Cue edits are undoable and Producer changes appear in the review summary. Matching cues accompany selected regions and saved phrases. Cues save with projects, portable `.vibe` files and templates. They do not extend the audio export duration or reschedule audio when edited.

Export lyrics as `.lrc` from the dock. Timestamps follow project tempo; put each separately timed line in its own cue. Multiple lines in one cue share a timestamp. Notes export as plain text. These cues describe intended lyrics; they do not create a vocal recording.

## Add context to the Producer

Type **@** in chat, then search by name, ID or type. The picker includes the current selection, tracks, clips, effects, sections, samples, saved library items, notes, lyrics, Producer listening reviews, checklists, assistant messages and analyzed reference tracks. Use arrow keys and Enter/Tab, or tap a result. References appear as removable chips. Project references refresh when sent; a selected region retains the note/range snapshot you attached.

The same catalog powers **Add to chat** buttons and right-click menus on project objects. Producer listening reviews have a dedicated attachment button and scroll independently when long. Right-click keeps the browser's normal menu for editable fields and selected text. Audio files still attach through the paperclip for analysis; analyzed references can be mentioned again during the chat.

## MIDI import

Import `.mid`/`.midi` through the sound browser or Projects. Standard MIDI format 0/1 with PPQ timing becomes editable notes and separate channel tracks, including General MIDI drums and sustain-pedal note lengths. Empty projects adopt the first tempo/meter; existing projects retain theirs. Imports form one undo step. Tempo/meter maps, controller automation, pitch bend and program changes are reported as limitations. SMPTE and format 2 are rejected with an explanation.

## Larger production gaps

Vibe still needs several substantial workflows before matching mature desktop DAWs: editable parameter automation, buses/aux sends and routing, live MIDI/audio recording with latency compensation, take lanes and comping, expressive pitch/MPE editing, tempo maps, broader plugin compatibility, and deeper sample slicing/time-stretch controls. These require coordinated engine/editor work and dedicated musical verification. This PR supplies reusable assets, templates, MIDI interchange and writing cues alongside the audio and editing improvements; it does not claim complete feature parity or physical-device performance guarantees.
