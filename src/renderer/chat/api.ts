import type { AiApi } from '../../shared/ai';

export { errorCode, validMinutes } from './viewState';

declare global { interface Window { aiApi: AiApi } }
export const aiApi = window.aiApi;
