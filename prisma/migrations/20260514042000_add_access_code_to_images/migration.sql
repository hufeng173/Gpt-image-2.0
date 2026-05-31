-- Add access-code ownership to generated image jobs and images.
ALTER TABLE `ImageJob` ADD COLUMN `accessCodeId` VARCHAR(191) NULL;
ALTER TABLE `Image` ADD COLUMN `accessCodeId` VARCHAR(191) NULL;

CREATE INDEX `ImageJob_accessCodeId_idx` ON `ImageJob`(`accessCodeId`);
CREATE INDEX `Image_accessCodeId_idx` ON `Image`(`accessCodeId`);

ALTER TABLE `ImageJob`
  ADD CONSTRAINT `ImageJob_accessCodeId_fkey`
  FOREIGN KEY (`accessCodeId`) REFERENCES `AccessCode`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Image`
  ADD CONSTRAINT `Image_accessCodeId_fkey`
  FOREIGN KEY (`accessCodeId`) REFERENCES `AccessCode`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
