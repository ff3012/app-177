-- Die Empfänger leben seit der Migration 20261115090000_report_type_setting je Berichtsart in "ReportTypeSetting".
-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "reportRecipients";
