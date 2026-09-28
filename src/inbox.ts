import type { Data } from "./lib";

export const needsAttention = (task: Data) =>
  ["failed", "waiting_config"].includes(task.stage);
export const isProcessing = (task: Data) =>
  !["completed", "cancelled", "failed", "waiting_config"].includes(task.stage);

type MaterialGroup = {
  key: string;
  latest: Data;
  tasks: Data[];
  version: number;
  versionCount: number;
};

export function groupMaterials(tasks: Data[]) {
  const groups = new Map<string, MaterialGroup>();
  for (const task of [...tasks].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    const key = task.material?.key || task.id;
    let group = groups.get(key);
    if (!group) {
      group = { key, latest: task, tasks: [], version: 0, versionCount: 0 };
      groups.set(key, group);
    }
    group.tasks.push(task);
  }
  const versions = new Map<string, MaterialGroup[]>();
  for (const group of groups.values()) {
    const material = group.latest.material;
    if (!material?.verified || !material.sourceKey) continue;
    const family = versions.get(material.sourceKey) || [];
    family.push(group);
    versions.set(material.sourceKey, family);
  }
  for (const family of versions.values()) {
    family.sort((a, b) =>
      a.tasks[a.tasks.length - 1].created_at.localeCompare(
        b.tasks[b.tasks.length - 1].created_at,
      ),
    );
    family.forEach((g, i) => {
      g.version = i + 1;
      g.versionCount = family.length;
    });
  }
  return [...groups.values()];
}

export function matchingQuestions(group: Data, query: string, status: string) {
  const term = query.trim().toLowerCase();
  const titleMatches = group.tasks.some((t: Data) =>
    `${t.title} ${t.input.url || ""}`.toLowerCase().includes(term),
  );
  return group.tasks.filter(
    (t: Data) =>
      (!term ||
        titleMatches ||
        (t.question || "默认整理").toLowerCase().includes(term)) &&
      (status === "all" ||
        (status === "active" && isProcessing(t)) ||
        (status === "attention" && needsAttention(t)) ||
        status === t.stage),
  );
}
