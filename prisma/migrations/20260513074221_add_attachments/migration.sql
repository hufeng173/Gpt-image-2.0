-- CreateTable
CREATE TABLE `Attachment` (
    `id` VARCHAR(191) NOT NULL,
    `accessCodeId` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `kind` ENUM('IMAGE', 'DOCUMENT', 'SPREADSHEET', 'TEXT', 'OTHER') NOT NULL,
    `status` ENUM('PROCESSING', 'READY', 'FAILED') NOT NULL DEFAULT 'READY',
    `url` TEXT NULL,
    `storagePath` TEXT NOT NULL,
    `summary` TEXT NULL,
    `materials` JSON NULL,
    `warnings` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attachment_accessCodeId_idx`(`accessCodeId`),
    INDEX `Attachment_conversationId_idx`(`conversationId`),
    INDEX `Attachment_kind_idx`(`kind`),
    INDEX `Attachment_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_accessCodeId_fkey` FOREIGN KEY (`accessCodeId`) REFERENCES `AccessCode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attachment` ADD CONSTRAINT `Attachment_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `SavedConversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
