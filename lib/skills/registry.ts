import { imageMaterialFromAttachmentsSkill } from "./image-material-from-attachments";
import type { AttachmentKind, RuntimeSkill } from "./types";

const runtimeSkills = new Map<string, RuntimeSkill>([
  [imageMaterialFromAttachmentsSkill.name, imageMaterialFromAttachmentsSkill],
]);

export function getRuntimeSkill(name: string) {
  return runtimeSkills.get(name);
}

export function getAttachmentMaterialSkill(kind: AttachmentKind) {
  const skill = getRuntimeSkill("image-material-from-attachments");
  if (!skill || !skill.inputKinds.includes(kind)) {
    throw new Error(`No runtime skill registered for attachment kind ${kind}.`);
  }
  return skill;
}

export function listRuntimeSkills() {
  return Array.from(runtimeSkills.values()).map((skill) => ({
    name: skill.name,
    version: skill.version,
    inputKinds: skill.inputKinds,
  }));
}
