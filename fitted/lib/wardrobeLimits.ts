import { MAX_WARDROBE_IMAGE_BYTES } from "./imageStorage";
/** Shared wardrobe storage limits; route modules export only Next.js handlers/config. */
export const MAX_ITEMS_PER_USER = 300;
export const MAX_USER_IMAGE_BYTES = 80 * 1024 * 1024;
export const CREATE_RATE_MAX = 60;
export const UPLOAD_RATE_MAX = 60;
export const MAX_WARDROBE_IMAGE_REQUEST_BYTES = MAX_WARDROBE_IMAGE_BYTES + 64 * 1024;
