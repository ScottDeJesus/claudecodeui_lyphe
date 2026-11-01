import { AppError } from '@/shared/utils.js';

/**
 * The three refusals of the face door, as the app's own `AppError` envelope (`{ success: false, error: { code, message } }`).
 * Consumed by `face.service.ts` (a photo that is no photo, a face that is not hers to read, the server stopping) and by
 * `face.routes.ts` (a body with no photo, a photo past the size limit, a sheet number that names nothing).
 */

/** 400 `COMPANION_FACE_INVALID`: `sentence` names what is wrong with the upload, and is what the Settings card shows under its button. */
export function faceInvalid(sentence: string): AppError {
  return new AppError(sentence, { code: 'COMPANION_FACE_INVALID', statusCode: 400 });
}

/** The most of a key the "no such look" sentence repeats: the house's keys are a few letters, so a longer one names no look and needs only its head shown. */
const KEY_ECHO_MAX = 40;

/** 400 `COMPANION_FACE_INVALID`: `key` names none of the account's looks. The sentence repeats the key (its first `KEY_ECHO_MAX` characters), so the card says which look it asked for. */
export function faceNoSuchLook(key: string): AppError {
  const characters = [...key]; // by code point: a cut must not split a surrogate pair
  return faceInvalid(`There is no look called ${characters.length > KEY_ECHO_MAX ? `${characters.slice(0, KEY_ECHO_MAX).join('')}…` : key}.`);
}

/** 404 `COMPANION_FACE_NOT_FOUND`: the face is not a house look's or the one this account made from its photo, or it is not made, or the file is not one of its files. */
export function faceNotFound(): AppError {
  return new AppError('That face is not available to this account.', { code: 'COMPANION_FACE_NOT_FOUND', statusCode: 404 });
}

/** 503 `COMPANION_STOPPING`: the server is shutting down, so no face is taken or restored. */
export function faceStopping(): AppError {
  return new AppError('The server is shutting down, so her face cannot be changed just now; try again once it is back.', {
    code: 'COMPANION_STOPPING',
    statusCode: 503,
  });
}
