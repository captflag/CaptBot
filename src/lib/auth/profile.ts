let profileId: string | null = null;

/** Namespaces a storage key by the signed-in user, so accounts sharing a browser stay separate. */
export function profileKey(base: string): string {
  return profileId ? `${base}:${profileId}` : base;
}

export function setProfileId(id: string | null) {
  profileId = id;
}
