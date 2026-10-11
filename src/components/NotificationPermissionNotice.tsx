// Jabeja fork: one bottom-left card asking to turn notifications on, so a
// bot's answer reaches you while you are in another app (src/lib/notify.ts).
// Only where the browser has not been answered yet: the desktop app grants
// it by itself (electron/app-permissions.mjs), and a decided browser is
// never asked again.
import { useState } from "react";
import { Bell } from "lucide-react";
import { t } from "@/lib/i18n";
import { notificationPromptDue, putOffNotificationPrompt, requestNotificationPermission } from "@/lib/notify";
import { NoticeCard, NotNowButton, PRIMARY_BUTTON } from "./NoticeCard";

export function NotificationPermissionNotice({ quiet = false }: { quiet?: boolean }) {
  const [due, setDue] = useState(notificationPromptDue);
  if (!due || quiet) return null;
  const putOff = () => {
    putOffNotificationPrompt();
    setDue(false);
  };
  return (
    <NoticeCard titleId="notification-permission-title" notice="notification-permission" icon={Bell} title={t("notifications.prompt.title")} onDismiss={putOff}>
      <p className="mb-3 mt-1 text-[12.5px] text-ink-secondary">{t("notifications.prompt.body")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => void requestNotificationPermission()?.finally(() => setDue(notificationPromptDue()))}
        >
          {t("notifications.prompt.allow")}
        </button>
        <NotNowButton onClick={putOff} />
      </div>
    </NoticeCard>
  );
}
