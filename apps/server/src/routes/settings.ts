import {
  type SettingsResponse,
  settingsPatchSchema,
  settingsResponseSchema,
} from '@lorekeeper/shared';
import {
  getComposer,
  getGlobalDefaults,
  getImageCaptioning,
  getPromptTemplate,
  setSettingRaw,
} from '../services/settingsRepo';
import type { AppInstance } from '../types/app';

export function readSettings(db: AppInstance['db']): SettingsResponse {
  return {
    globalDefaults: getGlobalDefaults(db),
    promptTemplate: getPromptTemplate(db),
    composer: getComposer(db),
    imageCaptioning: getImageCaptioning(db),
  };
}

export async function registerSettingsRoutes(app: AppInstance): Promise<void> {
  app.get('/api/settings', { schema: { response: { 200: settingsResponseSchema } } }, async () =>
    readSettings(app.db),
  );

  app.patch(
    '/api/settings',
    {
      schema: {
        body: settingsPatchSchema,
        response: { 200: settingsResponseSchema },
      },
    },
    async (request) => {
      const patch = request.body;
      if (patch.globalDefaults) {
        const next = { ...getGlobalDefaults(app.db), ...patch.globalDefaults };
        setSettingRaw(app.db, 'globalDefaults', next);
      }
      if (patch.promptTemplate) {
        const next = { ...getPromptTemplate(app.db), ...patch.promptTemplate };
        setSettingRaw(app.db, 'promptTemplate', next);
      }
      if (patch.composer) {
        const next = { ...getComposer(app.db), ...patch.composer };
        setSettingRaw(app.db, 'composer', next);
      }
      if (patch.imageCaptioning) {
        const next = { ...getImageCaptioning(app.db), ...patch.imageCaptioning };
        setSettingRaw(app.db, 'imageCaptioning', next);
      }
      return readSettings(app.db);
    },
  );
}
