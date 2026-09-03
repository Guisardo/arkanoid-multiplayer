export const ROOM_CODE_REGEX = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

export function validateRoomCode(code: string): boolean {
  return ROOM_CODE_REGEX.test(code);
}
