/** Kept import-free so sandboxed preloads do not require shared output chunks. */
export const AI_CH = {
  snapshot: 'ai:snapshot', changed: 'ai:changed', saveProfile: 'ai:saveProfile', deleteProfile: 'ai:deleteProfile',
  configure: 'ai:configure', setSearchKey: 'ai:setSearchKey', models: 'ai:models', test: 'ai:test', create: 'ai:create',
  setProfile: 'ai:setProfile', send: 'ai:send', retry: 'ai:retry', stop: 'ai:stop', remove: 'ai:remove',
  adjustTimer: 'ai:adjustTimer', cancelTimer: 'ai:cancelTimer', openExternal: 'ai:openExternal',
  openSettings: 'ai:openSettings', copy: 'ai:copy',
  navigate: 'ai:navigate', openChat: 'ai:openChat', getLocale: 'ai:getLocale',
} as const;
