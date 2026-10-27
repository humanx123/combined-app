import {
  Archive, AudioLines, Code, Bookmark, CircleStop, Download, Drum, Ear, Eye, FolderOpen, Gauge, Globe, Layers, Library, ListChecks, Music, Pencil, Piano, Play, Plus, Repeat, Scissors, Search, SlidersHorizontal, StickyNote, Trash,
  type Icon,
} from './icons';

/** The icon each Producer tool row shows in the chat. Every agent tool needs one (see toolIcons.test.ts). */
export const TOOL_ICONS: Record<string, Icon> = {
  listen: Ear, audition_samples: Ear, write_drums: Drum, write_notes: Piano, create_track: Plus,
  update_track: Pencil, delete_track: Trash, add_effect: SlidersHorizontal, update_effect: SlidersHorizontal, remove_effect: SlidersHorizontal,
  search_samples: Search, design_sound: AudioLines, set_project: Gauge, copy_bars: Layers, clear_bars: Scissors, play: Play, stop: CircleStop,
  set_drum_lane: Drum, add_audio_clip: AudioLines, edit_clip: Pencil, delete_clips: Trash, transform_notes: Music, set_sections: ListChecks,
  bounce_to_sample: AudioLines, set_loop: Repeat, get_project_state: Eye, get_notes: Eye, replace_selected_notes: Music,
  search_online_sounds: Globe, import_online_sound: Download, update_plan: ListChecks, manage_context: Archive,
  add_annotation: StickyNote, edit_annotation: Pencil, delete_annotation: Trash, list_annotations: StickyNote,
  get_custom_effect: Code, list_library: Library, load_library_item: FolderOpen, save_library_item: Bookmark,
  get_producer_skill: Library,
};
