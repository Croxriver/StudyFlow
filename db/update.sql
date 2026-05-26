IF COL_LENGTH('dbo.books', 'minimum_study_minutes') IS NULL
  ALTER TABLE dbo.books ADD minimum_study_minutes INT NOT NULL CONSTRAINT DF_books_minimum_study_minutes DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.study_entries', 'minimum_study_minutes') IS NULL
  ALTER TABLE dbo.study_entries ADD minimum_study_minutes INT NOT NULL CONSTRAINT DF_study_entries_minimum_study_minutes DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.children', 'phone') IS NULL
  ALTER TABLE dbo.children ADD phone NVARCHAR(30) NULL;
GO

IF COL_LENGTH('dbo.children', 'parent_phone') IS NULL
  ALTER TABLE dbo.children ADD parent_phone NVARCHAR(30) NULL;
GO

IF OBJECT_ID('dbo.access_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.access_logs (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_access_logs PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NULL,
    child_id UNIQUEIDENTIFIER NULL,
    role NVARCHAR(20) NOT NULL,
    login_id NVARCHAR(255) NULL,
    ip_address NVARCHAR(64) NULL,
    user_agent NVARCHAR(500) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_access_logs_created_at DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_access_logs_created_at ON dbo.access_logs(created_at DESC);
  CREATE INDEX IX_access_logs_user_role ON dbo.access_logs(user_id, child_id, role, created_at DESC);
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_create_access_log
  @user_id UNIQUEIDENTIFIER = NULL,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @login_id NVARCHAR(255) = NULL,
  @ip_address NVARCHAR(64) = NULL,
  @user_agent NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.access_logs
  WHERE created_at < DATEADD(MONTH, -6, SYSUTCDATETIME());

  INSERT INTO dbo.access_logs (user_id, child_id, role, login_id, ip_address, user_agent)
  VALUES (@user_id, @child_id, @role, NULLIF(@login_id, ''), NULLIF(@ip_address, ''), NULLIF(@user_agent, ''));
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_access_logs
  @user_id UNIQUEIDENTIFIER,
  @limit INT = 30
AS
BEGIN
  SET NOCOUNT ON;

  DELETE FROM dbo.access_logs
  WHERE created_at < DATEADD(MONTH, -6, SYSUTCDATETIME());

  SELECT TOP (CASE WHEN @limit BETWEEN 1 AND 100 THEN @limit ELSE 30 END)
    id,
    role,
    login_id AS loginId,
    ip_address AS ipAddress,
    user_agent AS userAgent,
    created_at AS createdAt
  FROM dbo.access_logs
  WHERE user_id = @user_id AND child_id IS NULL AND role = N'teacher'
  ORDER BY created_at DESC, id DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_study_state
  @user_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    name,
    email,
    phone,
    marketing_consent AS marketingConsent
  FROM dbo.users
  WHERE id = @user_id;

  SELECT
    id,
    name,
    birth_month AS birthMonth,
    phone,
    parent_phone AS parentPhone,
    login_id AS loginId
  FROM dbo.children
  WHERE user_id = @user_id
  ORDER BY sort_order, birth_month, name;

  SELECT
    id,
    name,
    color
  FROM dbo.subject_settings
  WHERE user_id = @user_id
  ORDER BY sort_order, name;

  SELECT
    b.id,
    b.child_id AS childId,
    c.name AS childName,
    b.subject_setting_id AS subjectSettingId,
    ss.name AS subjectName,
    b.name AS book,
    b.schedule_time AS scheduleTime,
    b.minimum_study_minutes AS minimumStudyMinutes,
    b.start_date AS startDate,
    b.end_date AS endDate,
    b.reward_enabled AS rewardEnabled,
    b.reward_amount AS rewardAmount,
    b.reward_label AS rewardLabel
  FROM dbo.books b
  INNER JOIN dbo.children c ON c.id = b.child_id
  INNER JOIN dbo.subject_settings ss ON ss.id = b.subject_setting_id
  WHERE b.user_id = @user_id
  ORDER BY c.sort_order, ss.sort_order, b.name;

  SELECT
    bsd.book_id AS bookId,
    bsd.day_of_week AS dayOfWeek
  FROM dbo.book_schedule_days bsd
  INNER JOIN dbo.books b ON b.id = bsd.book_id
  WHERE b.user_id = @user_id
  ORDER BY bsd.day_of_week;

  SELECT
    se.book_id AS bookId,
    c.name AS childName,
    se.study_date AS studyDate,
    se.amount,
    se.minimum_study_minutes AS minimumStudyMinutes,
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
    se.study_started_at AS studyStartedAt,
    se.study_duration_seconds AS studyDurationSeconds,
    se.student_feedback AS studentFeedback,
    se.updated_at AS updatedAt
  FROM dbo.study_entries se
  INNER JOIN dbo.children c ON c.id = se.child_id
  WHERE se.user_id = @user_id
  ORDER BY se.study_date;

  SELECT
    setting_key AS settingKey,
    setting_value AS settingValue
  FROM dbo.user_settings
  WHERE user_id = @user_id
  ORDER BY setting_key;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_save_study_state
  @user_id UNIQUEIDENTIFIER,
  @state_json NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRANSACTION;

  DECLARE @existing_child_passwords TABLE (
    id UNIQUEIDENTIFIER NOT NULL,
    login_id NVARCHAR(100) NULL,
    password_hash NVARCHAR(255) NULL
  );

  DECLARE @existing_books TABLE (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    child_id UNIQUEIDENTIFIER NOT NULL,
    subject_setting_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(200) NOT NULL,
    minimum_study_minutes INT NOT NULL
  );

  DECLARE @existing_entries TABLE (
    child_id UNIQUEIDENTIFIER NOT NULL,
    book_id UNIQUEIDENTIFIER NOT NULL,
    study_date DATE NOT NULL,
    amount NVARCHAR(200) NULL,
    minimum_study_minutes INT NOT NULL,
    memo NVARCHAR(1000) NULL,
    completed BIT NOT NULL,
    reward_awarded BIT NOT NULL,
    reward_amount INT NOT NULL,
    reward_label NVARCHAR(50) NULL,
    reward_redeemed BIT NOT NULL,
    reward_redeemed_at DATETIME2(0) NULL,
    study_started_at DATETIME2(0) NULL,
    study_duration_seconds INT NOT NULL,
    student_feedback NVARCHAR(1000) NULL,
    updated_at DATETIME2(0) NOT NULL
  );

  INSERT INTO @existing_child_passwords (id, login_id, password_hash)
  SELECT id, login_id, password_hash
  FROM dbo.children
  WHERE user_id = @user_id;

  INSERT INTO @existing_books (id, child_id, subject_setting_id, name, minimum_study_minutes)
  SELECT id, child_id, subject_setting_id, name, minimum_study_minutes
  FROM dbo.books
  WHERE user_id = @user_id;

  INSERT INTO @existing_entries
    (child_id, book_id, study_date, amount, minimum_study_minutes, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, study_started_at, study_duration_seconds, student_feedback, updated_at)
  SELECT
    child_id,
    book_id,
    study_date,
    amount,
    minimum_study_minutes,
    memo,
    completed,
    reward_awarded,
    reward_amount,
    reward_label,
    reward_redeemed,
    reward_redeemed_at,
    study_started_at,
    study_duration_seconds,
    student_feedback,
    updated_at
  FROM dbo.study_entries
  WHERE user_id = @user_id;

  UPDATE dbo.users
  SET
    name = COALESCE(NULLIF(JSON_VALUE(@state_json, '$.profile.name'), ''), name),
    phone = NULLIF(JSON_VALUE(@state_json, '$.profile.phone'), ''),
    marketing_consent = CASE
      WHEN JSON_VALUE(@state_json, '$.profile.marketingConsent') IN ('true', '1') THEN 1
      ELSE 0
    END,
    updated_at = SYSUTCDATETIME()
  WHERE id = @user_id;

  MERGE dbo.user_settings AS target
  USING (
    SELECT
      @user_id AS user_id,
      LEFT([key] COLLATE DATABASE_DEFAULT, 100) AS setting_key,
      LEFT(CONVERT(NVARCHAR(1000), value), 1000) AS setting_value
    FROM OPENJSON(@state_json, '$.userSettings')
    WHERE [key] IS NOT NULL AND LEN([key]) BETWEEN 1 AND 100
  ) AS source
  ON target.user_id = source.user_id AND target.setting_key = source.setting_key
  WHEN MATCHED THEN
    UPDATE SET
      setting_value = source.setting_value,
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (user_id, setting_key, setting_value)
    VALUES (source.user_id, source.setting_key, source.setting_value);

  DELETE FROM dbo.study_entries WHERE user_id = @user_id;

  DELETE bsd
  FROM dbo.book_schedule_days bsd
  INNER JOIN dbo.books b ON b.id = bsd.book_id
  WHERE b.user_id = @user_id;

  DELETE FROM dbo.books WHERE user_id = @user_id;
  DELETE FROM dbo.subject_settings WHERE user_id = @user_id;
  DELETE FROM dbo.children WHERE user_id = @user_id;

  INSERT INTO dbo.children (id, user_id, name, birth_month, phone, parent_phone, login_id, password_hash, sort_order)
  SELECT
    child.id,
    @user_id,
    child.name,
    TRY_CONVERT(date, NULLIF(child.birthMonth, '')),
    NULLIF(child.phone, ''),
    NULLIF(child.parentPhone, ''),
    CASE
      WHEN NULLIF(existingById.login_id, '') IS NOT NULL THEN existingById.login_id
      ELSE NULLIF(child.loginId, '')
    END,
    COALESCE(child.passwordHash, existingById.password_hash, existingByLogin.password_hash),
    child.[index]
  FROM OPENJSON(@state_json, '$.childAccounts')
  WITH (
    [index] INT '$.sortOrder',
    id UNIQUEIDENTIFIER '$.id',
    name NVARCHAR(100) '$.name',
    birthMonth NVARCHAR(10) '$.birthMonth',
    phone NVARCHAR(30) '$.phone',
    parentPhone NVARCHAR(30) '$.parentPhone',
    loginId NVARCHAR(100) '$.loginId',
    passwordHash NVARCHAR(255) '$.passwordHash'
  ) child
  LEFT JOIN @existing_child_passwords existingById ON existingById.id = child.id
  LEFT JOIN @existing_child_passwords existingByLogin ON existingByLogin.login_id = NULLIF(child.loginId, '')
  WHERE child.id IS NOT NULL AND NULLIF(child.name, '') IS NOT NULL;

  INSERT INTO dbo.subject_settings (id, user_id, name, color, sort_order)
  SELECT
    subject.id,
    @user_id,
    subject.name,
    subject.color,
    subject.[index]
  FROM OPENJSON(@state_json, '$.subjectSettings')
  WITH (
    [index] INT '$.sortOrder',
    id UNIQUEIDENTIFIER '$.id',
    name NVARCHAR(100) '$.name',
    color CHAR(7) '$.color'
  ) subject
  WHERE subject.id IS NOT NULL AND NULLIF(subject.name, '') IS NOT NULL;

  DECLARE @books TABLE (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    child_id UNIQUEIDENTIFIER NOT NULL,
    subject_setting_id UNIQUEIDENTIFIER NOT NULL,
    name NVARCHAR(200) NOT NULL,
    schedule_time NVARCHAR(5) NULL,
    minimum_study_minutes INT NOT NULL,
    minimum_study_minutes_source NVARCHAR(30) NULL,
    start_date NVARCHAR(10) NULL,
    end_date NVARCHAR(10) NULL,
    reward_enabled BIT NOT NULL,
    reward_amount INT NOT NULL,
    reward_label NVARCHAR(50) NULL,
    schedule_days NVARCHAR(MAX) NULL
  );

  INSERT INTO @books
    (id, child_id, subject_setting_id, name, schedule_time, minimum_study_minutes, minimum_study_minutes_source, start_date, end_date, reward_enabled, reward_amount, reward_label, schedule_days)
  SELECT
    book.id,
    TRY_CONVERT(uniqueidentifier, book.childId),
    book.subjectSettingId,
    book.book,
    NULLIF(book.scheduleTime, ''),
    CASE
      WHEN book.minimumStudyMinutes IS NULL THEN COALESCE(existing.minimum_study_minutes, existingByBook.minimum_study_minutes, 0)
      WHEN (existing.id IS NOT NULL OR existingByBook.id IS NOT NULL) AND COALESCE(book.minimumStudyMinutesSource, '') <> 'book-dialog' THEN COALESCE(existing.minimum_study_minutes, existingByBook.minimum_study_minutes, 0)
      WHEN TRY_CONVERT(int, book.minimumStudyMinutes) BETWEEN 10 AND 120 THEN (TRY_CONVERT(int, book.minimumStudyMinutes) / 10) * 10
      ELSE 0
    END,
    NULLIF(book.minimumStudyMinutesSource, ''),
    NULLIF(book.startDate, ''),
    NULLIF(book.endDate, ''),
    CASE WHEN book.rewardEnabled IN ('true', '1') THEN 1 ELSE 0 END,
    CASE WHEN TRY_CONVERT(int, book.rewardAmount) > 0 THEN TRY_CONVERT(int, book.rewardAmount) ELSE 0 END,
    NULLIF(book.rewardLabel, ''),
    book.scheduleDays
  FROM OPENJSON(@state_json, '$.books')
  WITH (
    id UNIQUEIDENTIFIER '$.id',
    childId NVARCHAR(36) '$.childId',
    subjectSettingId UNIQUEIDENTIFIER '$.subjectSettingId',
    book NVARCHAR(200) '$.book',
    scheduleTime NVARCHAR(5) '$.scheduleTime',
    minimumStudyMinutes NVARCHAR(20) '$.minimumStudyMinutes',
    minimumStudyMinutesSource NVARCHAR(30) '$.minimumStudyMinutesSource',
    startDate NVARCHAR(10) '$.startDate',
    endDate NVARCHAR(10) '$.endDate',
    rewardEnabled NVARCHAR(5) '$.rewardEnabled',
    rewardAmount NVARCHAR(20) '$.rewardAmount',
    rewardLabel NVARCHAR(50) '$.rewardLabel',
    scheduleDays NVARCHAR(MAX) '$.scheduleDays' AS JSON
  ) book
  LEFT JOIN @existing_books existing ON existing.id = book.id
  LEFT JOIN @existing_books existingByBook
    ON existingByBook.child_id = TRY_CONVERT(uniqueidentifier, book.childId)
    AND existingByBook.subject_setting_id = book.subjectSettingId
    AND existingByBook.name = book.book
  WHERE
    book.id IS NOT NULL
    AND book.subjectSettingId IS NOT NULL
    AND NULLIF(book.book, '') IS NOT NULL;

  INSERT INTO dbo.books
    (id, user_id, child_id, subject_setting_id, name, schedule_time, minimum_study_minutes, start_date, end_date, reward_enabled, reward_amount, reward_label)
  SELECT
    id,
    @user_id,
    child_id,
    subject_setting_id,
    name,
    TRY_CONVERT(time(0), schedule_time),
    minimum_study_minutes,
    TRY_CONVERT(date, start_date),
    TRY_CONVERT(date, end_date),
    reward_enabled,
    reward_amount,
    reward_label
  FROM @books;

  INSERT INTO dbo.book_schedule_days (book_id, day_of_week)
  SELECT
    book.id,
    TRY_CONVERT(tinyint, dayValue.value)
  FROM @books book
  CROSS APPLY OPENJSON(book.schedule_days) dayValue
  WHERE TRY_CONVERT(tinyint, dayValue.value) BETWEEN 0 AND 6;

  INSERT INTO dbo.study_entries
    (user_id, child_id, book_id, study_date, amount, minimum_study_minutes, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, study_started_at, study_duration_seconds, student_feedback, updated_at)
  SELECT
    @user_id,
    book.child_id,
    entry.bookId,
    TRY_CONVERT(date, entry.studyDate),
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.amount ELSE NULLIF(entry.amount, '') END,
    CASE
      WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.minimum_study_minutes
      WHEN entry.minimumStudyMinutes IS NULL THEN COALESCE(existing.minimum_study_minutes, 0)
      WHEN TRY_CONVERT(int, entry.minimumStudyMinutes) BETWEEN 10 AND 120 THEN (TRY_CONVERT(int, entry.minimumStudyMinutes) / 10) * 10
      ELSE 0
    END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.memo ELSE NULLIF(entry.memo, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.completed ELSE CASE WHEN entry.completed IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_awarded ELSE CASE WHEN entry.rewardAwarded IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_amount ELSE CASE WHEN TRY_CONVERT(int, entry.rewardAmount) > 0 THEN TRY_CONVERT(int, entry.rewardAmount) ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_label ELSE NULLIF(entry.rewardLabel, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_redeemed ELSE CASE WHEN entry.rewardRedeemed IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_redeemed_at ELSE TRY_CONVERT(datetime2(0), NULLIF(entry.rewardRedeemedAt, '')) END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.study_started_at ELSE TRY_CONVERT(datetime2(0), NULLIF(entry.studyStartedAt, '')) END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.study_duration_seconds ELSE CASE WHEN TRY_CONVERT(int, entry.studyDurationSeconds) > 0 THEN TRY_CONVERT(int, entry.studyDurationSeconds) ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.student_feedback ELSE NULLIF(entry.studentFeedback, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.updated_at ELSE COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), SYSUTCDATETIME()) END
  FROM OPENJSON(@state_json, '$.entriesList')
  WITH (
    bookId UNIQUEIDENTIFIER '$.bookId',
    studyDate NVARCHAR(10) '$.date',
    amount NVARCHAR(200) '$.amount',
    minimumStudyMinutes NVARCHAR(20) '$.minimumStudyMinutes',
    memo NVARCHAR(1000) '$.memo',
    completed NVARCHAR(5) '$.completed',
    rewardAwarded NVARCHAR(5) '$.rewardAwarded',
    rewardAmount NVARCHAR(20) '$.rewardAmount',
    rewardLabel NVARCHAR(50) '$.rewardLabel',
    rewardRedeemed NVARCHAR(5) '$.rewardRedeemed',
    rewardRedeemedAt NVARCHAR(40) '$.rewardRedeemedAt',
    studyStartedAt NVARCHAR(40) '$.studyStartedAt',
    studyDurationSeconds NVARCHAR(20) '$.studyDurationSeconds',
    studentFeedback NVARCHAR(1000) '$.studentFeedback',
    updatedAt NVARCHAR(40) '$.updatedAt'
  ) entry
  INNER JOIN @books book ON book.id = entry.bookId
  LEFT JOIN @existing_entries existing
    ON existing.child_id = book.child_id
    AND existing.book_id = entry.bookId
    AND existing.study_date = TRY_CONVERT(date, entry.studyDate)
  WHERE entry.bookId IS NOT NULL AND TRY_CONVERT(date, entry.studyDate) IS NOT NULL;

  INSERT INTO dbo.study_entries
    (user_id, child_id, book_id, study_date, amount, minimum_study_minutes, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, study_started_at, study_duration_seconds, student_feedback, updated_at)
  SELECT
    @user_id,
    existing.child_id,
    existing.book_id,
    existing.study_date,
    existing.amount,
    existing.minimum_study_minutes,
    existing.memo,
    existing.completed,
    existing.reward_awarded,
    existing.reward_amount,
    existing.reward_label,
    existing.reward_redeemed,
    existing.reward_redeemed_at,
    existing.study_started_at,
    existing.study_duration_seconds,
    existing.student_feedback,
    existing.updated_at
  FROM @existing_entries existing
  INNER JOIN @books book ON book.id = existing.book_id AND book.child_id = existing.child_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM OPENJSON(@state_json, '$.entriesList')
    WITH (
      bookId UNIQUEIDENTIFIER '$.bookId',
      studyDate NVARCHAR(10) '$.date'
    ) entry
    WHERE entry.bookId = existing.book_id
      AND TRY_CONVERT(date, entry.studyDate) = existing.study_date
  );

  COMMIT TRANSACTION;

  SELECT CAST(1 AS BIT) AS ok, N'database' AS persistence;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_student_study_state
  @teacher_user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    c.id,
    c.name,
    c.login_id AS loginId,
    c.birth_month AS birthMonth,
    u.name AS teacherName
  FROM dbo.children c
  INNER JOIN dbo.users u ON u.id = c.user_id
  WHERE c.user_id = @teacher_user_id AND c.id = @child_id;

  SELECT
    b.id,
    b.subject_setting_id AS subjectSettingId,
    ss.name AS subjectName,
    ss.color AS subjectColor,
    b.name AS book,
    b.schedule_time AS scheduleTime,
    b.minimum_study_minutes AS minimumStudyMinutes,
    b.start_date AS startDate,
    b.end_date AS endDate,
    b.reward_enabled AS rewardEnabled,
    b.reward_amount AS rewardAmount,
    b.reward_label AS rewardLabel
  FROM dbo.books b
  INNER JOIN dbo.subject_settings ss ON ss.id = b.subject_setting_id
  WHERE b.user_id = @teacher_user_id AND b.child_id = @child_id
  ORDER BY ss.sort_order, b.name;

  SELECT
    bsd.book_id AS bookId,
    bsd.day_of_week AS dayOfWeek
  FROM dbo.book_schedule_days bsd
  INNER JOIN dbo.books b ON b.id = bsd.book_id
  WHERE b.user_id = @teacher_user_id AND b.child_id = @child_id
  ORDER BY bsd.day_of_week;

  SELECT
    se.book_id AS bookId,
    se.study_date AS studyDate,
    se.amount,
    se.minimum_study_minutes AS minimumStudyMinutes,
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
    se.study_started_at AS studyStartedAt,
    se.study_duration_seconds AS studyDurationSeconds,
    se.student_feedback AS studentFeedback,
    se.updated_at AS updatedAt
  FROM dbo.study_entries se
  WHERE se.user_id = @teacher_user_id AND se.child_id = @child_id
  ORDER BY se.study_date;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_student_entry
  @teacher_user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE,
  @amount NVARCHAR(200) = NULL,
  @memo NVARCHAR(1000) = NULL,
  @completed BIT = 0,
  @study_started_at DATETIME2(0) = NULL,
  @study_duration_seconds INT = 0,
  @student_feedback NVARCHAR(1000) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE
    @reward_enabled BIT,
    @reward_amount INT,
    @reward_label NVARCHAR(50),
    @book_minimum_study_minutes INT = 0,
    @previous_reward_awarded BIT = 0,
    @previous_reward_amount INT = 0,
    @previous_reward_label NVARCHAR(50) = NULL,
    @previous_reward_redeemed BIT = 0,
    @previous_reward_redeemed_at DATETIME2(0) = NULL,
    @next_reward_awarded BIT = 0,
    @next_reward_amount INT = 0,
    @next_reward_label NVARCHAR(50) = NULL,
    @next_reward_redeemed BIT = 0,
    @next_reward_redeemed_at DATETIME2(0) = NULL;

  SELECT
    @reward_enabled = reward_enabled,
    @reward_amount = reward_amount,
    @reward_label = reward_label,
    @book_minimum_study_minutes = minimum_study_minutes
  FROM dbo.books
  WHERE id = @book_id AND user_id = @teacher_user_id AND child_id = @child_id;

  IF @reward_enabled IS NULL
  BEGIN
    RAISERROR('Book was not found for this student.', 16, 1);
    RETURN;
  END;

  SELECT
    @previous_reward_awarded = reward_awarded,
    @previous_reward_amount = reward_amount,
    @previous_reward_label = reward_label,
    @previous_reward_redeemed = reward_redeemed,
    @previous_reward_redeemed_at = reward_redeemed_at
  FROM dbo.study_entries
  WHERE user_id = @teacher_user_id AND child_id = @child_id AND book_id = @book_id AND study_date = @study_date;

  IF @previous_reward_awarded = 1
  BEGIN
    SELECT
      @next_reward_awarded = 1,
      @next_reward_amount = @previous_reward_amount,
      @next_reward_label = @previous_reward_label,
      @next_reward_redeemed = @previous_reward_redeemed,
      @next_reward_redeemed_at = @previous_reward_redeemed_at;
  END
  ELSE IF @completed = 1 AND @reward_enabled = 1 AND @reward_amount > 0
  BEGIN
    SELECT
      @next_reward_awarded = 1,
      @next_reward_amount = @reward_amount,
      @next_reward_label = @reward_label,
      @next_reward_redeemed = 0,
      @next_reward_redeemed_at = NULL;
  END;

  MERGE dbo.study_entries AS target
  USING (
    SELECT
      @teacher_user_id AS user_id,
      @child_id AS child_id,
      @book_id AS book_id,
      @study_date AS study_date
  ) AS source
  ON
    target.user_id = source.user_id
    AND target.child_id = source.child_id
    AND target.book_id = source.book_id
    AND target.study_date = source.study_date
  WHEN MATCHED THEN
    UPDATE SET
      amount = NULLIF(@amount, ''),
      memo = NULLIF(@memo, ''),
      completed = @completed,
      reward_awarded = @next_reward_awarded,
      reward_amount = @next_reward_amount,
      reward_label = @next_reward_label,
      reward_redeemed = @next_reward_redeemed,
      reward_redeemed_at = @next_reward_redeemed_at,
      study_started_at = @study_started_at,
      study_duration_seconds = CASE WHEN @study_duration_seconds > 0 THEN @study_duration_seconds ELSE 0 END,
      student_feedback = NULLIF(@student_feedback, ''),
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT
      (user_id, child_id, book_id, study_date, amount, minimum_study_minutes, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, study_started_at, study_duration_seconds, student_feedback, updated_at)
    VALUES
      (@teacher_user_id, @child_id, @book_id, @study_date, NULLIF(@amount, ''), @book_minimum_study_minutes, NULLIF(@memo, ''), @completed, @next_reward_awarded, @next_reward_amount, @next_reward_label, @next_reward_redeemed, @next_reward_redeemed_at, @study_started_at, CASE WHEN @study_duration_seconds > 0 THEN @study_duration_seconds ELSE 0 END, NULLIF(@student_feedback, ''), SYSUTCDATETIME());

  SELECT
    book_id AS bookId,
    study_date AS studyDate,
    amount,
    minimum_study_minutes AS minimumStudyMinutes,
    memo,
    completed,
    reward_awarded AS rewardAwarded,
    reward_amount AS rewardAmount,
    reward_label AS rewardLabel,
    reward_redeemed AS rewardRedeemed,
    reward_redeemed_at AS rewardRedeemedAt,
    study_started_at AS studyStartedAt,
    study_duration_seconds AS studyDurationSeconds,
    student_feedback AS studentFeedback,
    updated_at AS updatedAt
  FROM dbo.study_entries
  WHERE user_id = @teacher_user_id AND child_id = @child_id AND book_id = @book_id AND study_date = @study_date;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_teacher_entry
  @user_id UNIQUEIDENTIFIER,
  @child_name NVARCHAR(100),
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE,
  @amount NVARCHAR(200) = NULL,
  @memo NVARCHAR(1000) = NULL,
  @completed BIT = 0,
  @reward_awarded BIT = 0,
  @reward_amount INT = 0,
  @reward_label NVARCHAR(50) = NULL,
  @reward_redeemed BIT = 0,
  @reward_redeemed_at DATETIME2(0) = NULL,
  @study_started_at DATETIME2(0) = NULL,
  @study_duration_seconds INT = 0,
  @student_feedback NVARCHAR(1000) = NULL,
  @minimum_study_minutes INT = 0,
  @updated_at DATETIME2(0) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @child_id UNIQUEIDENTIFIER;

  SELECT @child_id = id
  FROM dbo.children
  WHERE user_id = @user_id AND name = @child_name;

  IF @child_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM dbo.books WHERE id = @book_id AND user_id = @user_id AND child_id = @child_id
  )
  BEGIN
    RAISERROR('Entry target was not found.', 16, 1);
    RETURN;
  END;

  MERGE dbo.study_entries AS target
  USING (
    SELECT
      @user_id AS user_id,
      @child_id AS child_id,
      @book_id AS book_id,
      @study_date AS study_date
  ) AS source
  ON
    target.user_id = source.user_id
    AND target.child_id = source.child_id
    AND target.book_id = source.book_id
    AND target.study_date = source.study_date
  WHEN MATCHED THEN
    UPDATE SET
      amount = NULLIF(@amount, ''),
      minimum_study_minutes = CASE WHEN @minimum_study_minutes BETWEEN 10 AND 120 THEN (@minimum_study_minutes / 10) * 10 ELSE 0 END,
      memo = NULLIF(@memo, ''),
      completed = @completed,
      reward_awarded = @reward_awarded,
      reward_amount = CASE WHEN @reward_amount > 0 THEN @reward_amount ELSE 0 END,
      reward_label = NULLIF(@reward_label, ''),
      reward_redeemed = @reward_redeemed,
      reward_redeemed_at = @reward_redeemed_at,
      study_started_at = @study_started_at,
      study_duration_seconds = CASE WHEN @study_duration_seconds > 0 THEN @study_duration_seconds ELSE 0 END,
      student_feedback = NULLIF(@student_feedback, ''),
      updated_at = COALESCE(@updated_at, SYSUTCDATETIME())
  WHEN NOT MATCHED THEN
    INSERT
      (user_id, child_id, book_id, study_date, amount, minimum_study_minutes, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, study_started_at, study_duration_seconds, student_feedback, updated_at)
    VALUES
      (@user_id, @child_id, @book_id, @study_date, NULLIF(@amount, ''), CASE WHEN @minimum_study_minutes BETWEEN 10 AND 120 THEN (@minimum_study_minutes / 10) * 10 ELSE 0 END, NULLIF(@memo, ''), @completed, @reward_awarded, CASE WHEN @reward_amount > 0 THEN @reward_amount ELSE 0 END, NULLIF(@reward_label, ''), @reward_redeemed, @reward_redeemed_at, @study_started_at, CASE WHEN @study_duration_seconds > 0 THEN @study_duration_seconds ELSE 0 END, NULLIF(@student_feedback, ''), COALESCE(@updated_at, SYSUTCDATETIME()));

  SELECT
    c.name AS childName,
    se.book_id AS bookId,
    se.study_date AS studyDate,
    se.amount,
    se.minimum_study_minutes AS minimumStudyMinutes,
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
    se.study_started_at AS studyStartedAt,
    se.study_duration_seconds AS studyDurationSeconds,
    se.student_feedback AS studentFeedback,
    se.updated_at AS updatedAt
  FROM dbo.study_entries se
  INNER JOIN dbo.children c ON c.id = se.child_id
  WHERE se.user_id = @user_id AND se.child_id = @child_id AND se.book_id = @book_id AND se.study_date = @study_date;
END;
GO

