import { InitialsAvatar } from "./Avatar";
import { profileInitials } from "./SidebarProfileMenu";

/** Who sent a person's message, above the bubble, when it was not the
 * viewer (lib/people). The same shape as a relayed bot line's label. */
export function PersonLabel({ name }: { name: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 pr-0.5" data-testid="person-label">
      <InitialsAvatar initials={profileInitials({ name })} size={16} />
      <span className="text-[11px] font-medium text-ink-secondary">{name}</span>
    </div>
  );
}
