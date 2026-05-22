import type { z } from 'zod';
import type { Dialog } from 'playwright-core';
import { browserManager } from '../browserManager.js';
import type { handleDialogSchema } from '../schemas.js';
import type { ToolReturn } from '../watchdog.js';
import { ok, fail, tryFormatError } from '../result.js';

export async function handleDialog(args: z.infer<typeof handleDialogSchema>): Promise<ToolReturn> {
  try {
    const rec = browserManager.getPage(args.pageId);

    return await new Promise<ToolReturn>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        rec.page.off('dialog', onDialog);
        resolve(fail('handle_dialog timed out: no dialog appeared within timeoutMs'));
      }, args.timeoutMs);

      const onDialog = async (dialog: Dialog) => {
        clearTimeout(timeoutHandle);
        rec.page.off('dialog', onDialog);

        const type = dialog.type();
        const message = dialog.message();
        const defaultValue = dialog.defaultValue();

        try {
          if (args.action === 'accept') {
            await dialog.accept(args.promptText ?? dialog.defaultValue());
          } else {
            await dialog.dismiss();
          }
          resolve(
            ok({
              type,
              message,
              defaultValue: defaultValue || undefined,
              action: args.action,
            }),
          );
        } catch (err) {
          const { message: errMsg, hint } = tryFormatError(err);
          resolve(fail(`handle_dialog action failed: ${errMsg}`, hint));
        }
      };

      rec.page.on('dialog', onDialog);
    });
  } catch (err) {
    const { message, hint } = tryFormatError(err);
    return fail(`handle_dialog failed: ${message}`, hint);
  }
}
