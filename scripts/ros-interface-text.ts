/** ROS 2 `.msg` / `.srv` / `.action` section selection. */

export type RootKind =
  | "msg"
  | "srv_request"
  | "srv_response"
  | "action_goal"
  | "action_result"
  | "action_feedback";

export function expectedSeparatorCount(kind: RootKind): number {
  switch (kind) {
    case "msg":
      return 0;
    case "srv_request":
    case "srv_response":
      return 1;
    case "action_goal":
    case "action_result":
    case "action_feedback":
      return 2;
  }
}

/**
 * Select the active field-section text for a root from parent interface text.
 * Separator lines are trimmed content exactly `---`.
 */
export function selectInterfaceSection(
  content: string,
  kind: RootKind,
): { ok: true; section: string } | { ok: false; reason: string } {
  const lines = content.split("\n");
  const separators: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") separators.push(i);
  }
  const expected = expectedSeparatorCount(kind);
  if (separators.length !== expected) {
    return {
      ok: false,
      reason: `expected ${expected} --- separator(s) for ${kind}, found ${separators.length}`,
    };
  }
  let start = 0;
  let end = lines.length;
  if (kind === "msg") {
    // whole body
  } else if (kind === "srv_request" || kind === "action_goal") {
    end = separators[0]!;
  } else if (kind === "srv_response") {
    start = separators[0]! + 1;
  } else if (kind === "action_result") {
    start = separators[0]! + 1;
    end = separators[1]!;
  } else if (kind === "action_feedback") {
    start = separators[1]! + 1;
  }
  const section = lines.slice(start, end).join("\n");
  if (section.trim().length === 0) {
    return { ok: false, reason: `empty interface section for ${kind}` };
  }
  return { ok: true, section };
}
