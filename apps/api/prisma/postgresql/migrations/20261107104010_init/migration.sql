-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT,
    "education" TEXT,
    "graduationYear" INTEGER,
    "skillsJson" TEXT NOT NULL DEFAULT '[]',
    "preferredRoles" TEXT NOT NULL DEFAULT '[]',
    "locations" TEXT NOT NULL DEFAULT '[]',
    "remotePreference" TEXT NOT NULL DEFAULT 'ANY',

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "skillsJson" TEXT NOT NULL DEFAULT '[]',
    "preferredRoles" TEXT NOT NULL DEFAULT '[]',
    "locations" TEXT NOT NULL DEFAULT '[]',
    "remotePreference" TEXT NOT NULL DEFAULT 'ANY',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "educationJson" TEXT NOT NULL DEFAULT '[]',
    "experienceJson" TEXT NOT NULL DEFAULT '[]',
    "projectsJson" TEXT NOT NULL DEFAULT '[]',
    "certificationsJson" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceBoardId" TEXT,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "applicationUrl" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "skillsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "filters" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDraft" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resumeSummary" TEXT NOT NULL DEFAULT '',
    "highlightsJson" TEXT NOT NULL DEFAULT '[]',
    "coverLetter" TEXT NOT NULL DEFAULT '',
    "reviewNotesJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationTracking" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "notes" TEXT NOT NULL DEFAULT '',
    "appliedAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT NOT NULL DEFAULT '[]',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCandidateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillsJson" TEXT NOT NULL DEFAULT '[]',
    "preferredRoles" TEXT NOT NULL DEFAULT '[]',
    "locations" TEXT NOT NULL DEFAULT '[]',
    "remotePreference" TEXT NOT NULL DEFAULT 'ANY',
    "educationJson" TEXT NOT NULL DEFAULT '[]',
    "experienceJson" TEXT NOT NULL DEFAULT '[]',
    "projectsJson" TEXT NOT NULL DEFAULT '[]',
    "certificationsJson" TEXT NOT NULL DEFAULT '[]',
    "fullName" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "pinCode" TEXT NOT NULL DEFAULT '',
    "linkedinUrl" TEXT NOT NULL DEFAULT '',
    "githubUrl" TEXT NOT NULL DEFAULT '',
    "portfolioUrl" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSavedJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSavedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApplicationDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resumeSummary" TEXT NOT NULL DEFAULT '',
    "highlightsJson" TEXT NOT NULL DEFAULT '[]',
    "coverLetter" TEXT NOT NULL DEFAULT '',
    "reviewNotesJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "workflowStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApplicationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserApplicationTracking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "notes" TEXT NOT NULL DEFAULT '',
    "appliedAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserApplicationTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionPairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionPairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_provider_boardId_key" ON "JobSource"("provider", "boardId");

-- CreateIndex
CREATE INDEX "Job_title_idx" ON "Job"("title");

-- CreateIndex
CREATE INDEX "Job_company_idx" ON "Job"("company");

-- CreateIndex
CREATE INDEX "Job_location_idx" ON "Job"("location");

-- CreateIndex
CREATE INDEX "Job_publishedAt_idx" ON "Job"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_source_externalId_key" ON "Job"("source", "externalId");

-- CreateIndex
CREATE INDEX "SavedJob_userId_idx" ON "SavedJob"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedJob_userId_jobId_key" ON "SavedJob"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationDraft_jobId_key" ON "ApplicationDraft"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationTracking_jobId_key" ON "ApplicationTracking"("jobId");

-- CreateIndex
CREATE INDEX "ApplicationTracking_status_idx" ON "ApplicationTracking"("status");

-- CreateIndex
CREATE INDEX "ApplicationTracking_followUpAt_idx" ON "ApplicationTracking"("followUpAt");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_idx" ON "SavedSearch"("userId");

-- CreateIndex
CREATE INDEX "SyncRun_provider_boardId_startedAt_idx" ON "SyncRun"("provider", "boardId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserCandidateProfile_userId_key" ON "UserCandidateProfile"("userId");

-- CreateIndex
CREATE INDEX "UserSavedJob_userId_idx" ON "UserSavedJob"("userId");

-- CreateIndex
CREATE INDEX "UserSavedJob_jobId_idx" ON "UserSavedJob"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSavedJob_userId_jobId_key" ON "UserSavedJob"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserSavedSearch_userId_idx" ON "UserSavedSearch"("userId");

-- CreateIndex
CREATE INDEX "UserApplicationDraft_userId_idx" ON "UserApplicationDraft"("userId");

-- CreateIndex
CREATE INDEX "UserApplicationDraft_jobId_idx" ON "UserApplicationDraft"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "UserApplicationDraft_userId_jobId_key" ON "UserApplicationDraft"("userId", "jobId");

-- CreateIndex
CREATE INDEX "UserApplicationTracking_userId_idx" ON "UserApplicationTracking"("userId");

-- CreateIndex
CREATE INDEX "UserApplicationTracking_jobId_idx" ON "UserApplicationTracking"("jobId");

-- CreateIndex
CREATE INDEX "UserApplicationTracking_status_idx" ON "UserApplicationTracking"("status");

-- CreateIndex
CREATE INDEX "UserApplicationTracking_followUpAt_idx" ON "UserApplicationTracking"("followUpAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserApplicationTracking_userId_jobId_key" ON "UserApplicationTracking"("userId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionPairingCode_codeHash_key" ON "ExtensionPairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "ExtensionPairingCode_userId_idx" ON "ExtensionPairingCode"("userId");

-- CreateIndex
CREATE INDEX "ExtensionPairingCode_expiresAt_idx" ON "ExtensionPairingCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtensionAccessToken_tokenHash_key" ON "ExtensionAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ExtensionAccessToken_userId_idx" ON "ExtensionAccessToken"("userId");

-- CreateIndex
CREATE INDEX "ExtensionAccessToken_expiresAt_idx" ON "ExtensionAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationDraft" ADD CONSTRAINT "ApplicationDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTracking" ADD CONSTRAINT "ApplicationTracking_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCandidateProfile" ADD CONSTRAINT "UserCandidateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSavedJob" ADD CONSTRAINT "UserSavedJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSavedJob" ADD CONSTRAINT "UserSavedJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSavedSearch" ADD CONSTRAINT "UserSavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApplicationDraft" ADD CONSTRAINT "UserApplicationDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApplicationDraft" ADD CONSTRAINT "UserApplicationDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApplicationTracking" ADD CONSTRAINT "UserApplicationTracking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApplicationTracking" ADD CONSTRAINT "UserApplicationTracking_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionPairingCode" ADD CONSTRAINT "ExtensionPairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtensionAccessToken" ADD CONSTRAINT "ExtensionAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
