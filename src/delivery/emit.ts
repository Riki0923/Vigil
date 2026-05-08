import { logAlert, type Alert } from "../alerts/index.js";
import { appendAlert } from "./jsonStore.js";

export async function emitAlert(alert: Alert): Promise<void> {
  logAlert(alert);
  await appendAlert(alert);
}
