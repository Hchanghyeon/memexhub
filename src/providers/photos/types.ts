/** One picture or video in a photo library. `id` is opaque to the module (a relative path for a folder). */
export interface Photo {
  id: string;
  takenAt: string; // ISO instant
  name: string;
  kind: "photo" | "screenshot" | "video";
}
/** A photo library, read-only: a folder on the server (Synology Photos, Nextcloud auto-upload …) or a service. */
export interface PhotoSource {
  list(from: Date, to: Date): Promise<Photo[]>;
  /** A small JPEG/PNG of the picture for Claude to look at, or nothing when there is none. */
  preview(id: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
}
