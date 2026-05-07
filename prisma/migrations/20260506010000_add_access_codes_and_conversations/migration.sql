-- CreateTable
CREATE TABLE `AccessCode` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AccessCode_codeHash_key`(`codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SavedConversation` (
    `id` VARCHAR(191) NOT NULL,
    `accessCodeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `messages` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SavedConversation_accessCodeId_idx`(`accessCodeId`),
    INDEX `SavedConversation_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SavedConversation` ADD CONSTRAINT `SavedConversation_accessCodeId_fkey` FOREIGN KEY (`accessCodeId`) REFERENCES `AccessCode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
