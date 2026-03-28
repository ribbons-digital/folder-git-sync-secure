import type {
  RepoStatus,
  WorkingTreeFile,
  WorkingTreeFileKind
} from "../types.ts";

export function parseStatusPorcelainV2(output: string): RepoStatus {
  const files: WorkingTreeFile[] = [];
  let branch = "HEAD";
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;

  const records = output.split("\0").filter(Boolean);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";

    if (record.startsWith("# ")) {
      if (record.startsWith("# branch.head ")) {
        branch = record.slice("# branch.head ".length).trim();
      } else if (record.startsWith("# branch.upstream ")) {
        upstream = record.slice("# branch.upstream ".length).trim();
      } else if (record.startsWith("# branch.ab ")) {
        const abMatch = record.match(/# branch\.ab \+(?<ahead>\d+) -(?<behind>\d+)/);
        if (abMatch?.groups) {
          ahead = Number.parseInt(abMatch.groups.ahead ?? "0", 10);
          behind = Number.parseInt(abMatch.groups.behind ?? "0", 10);
        }
      }
      continue;
    }

    if (record.startsWith("? ")) {
      files.push({
        path: record.slice(2),
        indexStatus: "?",
        workTreeStatus: "?",
        staged: false,
        unstaged: true,
        conflicted: false,
        kind: "untracked"
      });
      continue;
    }

    if (record.startsWith("1 ")) {
      files.push(parseOrdinaryRecord(record));
      continue;
    }

    if (record.startsWith("2 ")) {
      const renamed = parseRenamedRecord(record, records[index + 1] ?? "");
      files.push(renamed);
      index += 1;
      continue;
    }

    if (record.startsWith("u ")) {
      files.push(parseUnmergedRecord(record));
    }
  }

  const stagedCount = files.filter((file) => file.staged).length;
  const modifiedCount = files.filter(
    (file) => file.unstaged && file.kind !== "untracked"
  ).length;
  const untrackedCount = files.filter(
    (file) => file.kind === "untracked"
  ).length;
  const hasConflicts = files.some((file) => file.conflicted);

  return {
    branch,
    upstream,
    ahead,
    behind,
    stagedCount,
    modifiedCount,
    untrackedCount,
    clean: files.length === 0,
    hasConflicts,
    files
  };
}

function parseOrdinaryRecord(record: string): WorkingTreeFile {
  const parts = record.split(" ");
  const xy = parts[1] ?? "..";
  const filePath = parts.slice(8).join(" ");

  return createWorkingTreeFile(filePath, xy, classifyKind(xy));
}

function parseRenamedRecord(record: string, originalPath: string): WorkingTreeFile {
  const parts = record.split(" ");
  const xy = parts[1] ?? "..";
  const filePath = parts.slice(9).join(" ");

  return createWorkingTreeFile(filePath, xy, classifyKind(xy, "renamed"), originalPath);
}

function parseUnmergedRecord(record: string): WorkingTreeFile {
  const parts = record.split(" ");
  const xy = parts[1] ?? "UU";
  const filePath = parts.slice(10).join(" ");

  return {
    path: filePath,
    indexStatus: xy[0] ?? "U",
    workTreeStatus: xy[1] ?? "U",
    staged: true,
    unstaged: true,
    conflicted: true,
    kind: "unmerged"
  };
}

function createWorkingTreeFile(
  filePath: string,
  xy: string,
  kind: WorkingTreeFileKind,
  originalPath?: string
): WorkingTreeFile {
  const indexStatus = xy[0] ?? ".";
  const workTreeStatus = xy[1] ?? ".";

  return {
    path: filePath,
    originalPath,
    indexStatus,
    workTreeStatus,
    staged: indexStatus !== ".",
    unstaged: workTreeStatus !== ".",
    conflicted: kind === "unmerged",
    kind
  };
}

function classifyKind(
  xy: string,
  fallback: WorkingTreeFileKind = "modified"
): WorkingTreeFileKind {
  if (xy.includes("R")) {
    return "renamed";
  }

  if (xy.includes("C")) {
    return "copied";
  }

  if (xy.includes("A")) {
    return "added";
  }

  if (xy.includes("D")) {
    return "deleted";
  }

  if (xy.includes("U")) {
    return "unmerged";
  }

  return fallback;
}
