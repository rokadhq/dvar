import type { DvarAction, DvarRisk, DvarRiskLevel } from "./types.js";

const capabilityScores: Record<string, number> = {
  "data.read": 8,
  "data.search": 8,
  "data.create": 20,
  "data.update": 28,
  "data.delete": 55,
  "data.export": 48,
  "filesystem.read": 12,
  "filesystem.write": 30,
  "filesystem.delete": 55,
  "network.request": 15,
  "network.download": 18,
  "network.upload": 45,
  "code.execute": 60,
  "shell.execute": 75,
  "communication.read": 15,
  "communication.send": 35,
  "communication.publish": 45,
  "finance.read": 20,
  "finance.charge": 65,
  "finance.refund": 60,
  "finance.transfer": 80,
  "identity.read": 20,
  "identity.manage": 70,
  "identity.impersonate": 90,
  "secrets.read": 75,
  "secrets.write": 80,
  "infrastructure.read": 20,
  "infrastructure.deploy": 58,
  "infrastructure.modify": 68,
  "infrastructure.delete": 85,
  "repository.read": 10,
  "repository.write": 35,
  "repository.merge": 55,
  "repository.admin": 82,
  "browser.navigate": 8,
  "browser.submit": 35,
  "browser.download": 20,
  "browser.purchase": 70,
  "system.admin": 95
};

function level(score: number): DvarRiskLevel {
  if (score >= 85) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  if (score >= 10) return "low";
  return "informational";
}

export function assessRisk(action: DvarAction): DvarRisk {
  const signals: string[] = [];
  let score = 0;
  for (const capability of action.tool.capabilities ?? []) {
    const capabilityScore = capabilityScores[capability] ?? 15;
    if (capabilityScore > score) score = capabilityScore;
    signals.push(`capability:${capability}`);
  }

  if (action.environment.toLowerCase() === "production") {
    score += 10;
    signals.push("environment:production");
  }
  if (action.destination !== undefined) {
    score += 5;
    signals.push("destination:external");
  }
  if ((action.trace?.depth ?? 0) >= 5) {
    score += 10;
    signals.push("runtime:deep_action_chain");
  }
  if (action.resources?.some((resource) => resource.classification === "restricted")) {
    score += 20;
    signals.push("data:restricted");
  }

  score = Math.max(0, Math.min(100, score));
  return { level: level(score), score, signals: [...new Set(signals)].sort() };
}
