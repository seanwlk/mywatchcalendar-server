-- DropIndex
DROP INDEX "Episode_externalIds_key";

-- DropIndex
DROP INDEX "Series_externalIds_key";

-- AlterTable
ALTER TABLE "Series" ADD COLUMN     "in_prod" BOOLEAN,
ADD COLUMN     "status" TEXT;
