import { asset } from "./web-build";

const IMAGE_EXTENSIONS = ["webp", "jpg", "jpeg", "png"];

// Given a path without extension (e.g. "/patronus/2"), finds whichever
// actual file exists by trying common image extensions in turn — so it
// doesn't matter whether a dropped-in photo is a .jpg, .jpeg, .png or .webp.
export function resolveImageUrl(basePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let i = 0;
    function tryNext() {
      if (i >= IMAGE_EXTENSIONS.length) {
        const tried = IMAGE_EXTENSIONS.map((ext) => `${basePath}.${ext}`).join(", ");
        reject(new Error(`no image found for ${basePath} (tried: ${tried})`));
        return;
      }
      const url = asset(`${basePath}.${IMAGE_EXTENSIONS[i]}`);
      const probe = new Image();
      probe.onload = () => resolve(url);
      probe.onerror = () => {
        i++;
        tryNext();
      };
      probe.src = url;
    }
    tryNext();
  });
}
