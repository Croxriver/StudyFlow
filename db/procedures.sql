IF COL_LENGTH('dbo.books', 'reward_enabled') IS NULL
  ALTER TABLE dbo.books ADD reward_enabled BIT NOT NULL CONSTRAINT DF_books_reward_enabled DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.books', 'reward_amount') IS NULL
  ALTER TABLE dbo.books ADD reward_amount INT NOT NULL CONSTRAINT DF_books_reward_amount DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.books', 'reward_label') IS NULL
  ALTER TABLE dbo.books ADD reward_label NVARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.study_entries', 'reward_awarded') IS NULL
  ALTER TABLE dbo.study_entries ADD reward_awarded BIT NOT NULL CONSTRAINT DF_study_entries_reward_awarded DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.study_entries', 'reward_amount') IS NULL
  ALTER TABLE dbo.study_entries ADD reward_amount INT NOT NULL CONSTRAINT DF_study_entries_reward_amount DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.study_entries', 'reward_label') IS NULL
  ALTER TABLE dbo.study_entries ADD reward_label NVARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.study_entries', 'reward_redeemed') IS NULL
  ALTER TABLE dbo.study_entries ADD reward_redeemed BIT NOT NULL CONSTRAINT DF_study_entries_reward_redeemed DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.study_entries', 'reward_redeemed_at') IS NULL
  ALTER TABLE dbo.study_entries ADD reward_redeemed_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.study_entries', 'updated_at') IS NULL
  ALTER TABLE dbo.study_entries ADD updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_study_entries_updated_at DEFAULT SYSUTCDATETIME() WITH VALUES;
GO

CREATE OR ALTER PROCEDURE dbo.app_create_user
  @email NVARCHAR(255),
  @password_hash NVARCHAR(255),
  @name NVARCHAR(100),
  @phone NVARCHAR(30) = NULL,
  @marketing_consent BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @created_user TABLE (
    id UNIQUEIDENTIFIER NOT NULL,
    email NVARCHAR(255) NOT NULL,
    name NVARCHAR(100) NOT NULL,
    phone NVARCHAR(30) NULL,
    marketingConsent BIT NOT NULL
  );

  BEGIN TRANSACTION;

  INSERT INTO dbo.users (email, password_hash, name, phone, marketing_consent)
  OUTPUT
    inserted.id,
    inserted.email,
    inserted.name,
    inserted.phone,
    inserted.marketing_consent
  INTO @created_user
  VALUES (@email, @password_hash, @name, @phone, @marketing_consent);

  INSERT INTO dbo.subject_settings (user_id, name, color, sort_order)
  SELECT created.id, defaults.name, defaults.color, defaults.sort_order
  FROM @created_user created
  CROSS APPLY (VALUES
    (N'국어', '#ef6461', 0),
    (N'영어', '#20a779', 1),
    (N'수학', '#2f78d4', 2)
  ) defaults(name, color, sort_order);

  COMMIT TRANSACTION;

  SELECT
    id,
    email,
    name,
    phone,
    marketingConsent
  FROM @created_user;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_user_by_email
  @email NVARCHAR(255)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    id,
    email,
    password_hash AS passwordHash,
    name,
    phone,
    marketing_consent AS marketingConsent
  FROM dbo.users
  WHERE email = @email;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_user_by_id
  @id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    id,
    email,
    name,
    phone,
    marketing_consent AS marketingConsent
  FROM dbo.users
  WHERE id = @id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_child_by_login_id
  @login_id NVARCHAR(100)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP (1)
    c.id,
    c.user_id AS teacherUserId,
    c.name,
    c.login_id AS loginId,
    c.password_hash AS passwordHash,
    u.name AS teacherName,
    u.email AS teacherEmail
  FROM dbo.children c
  INNER JOIN dbo.users u ON u.id = c.user_id
  WHERE c.login_id = @login_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_reset_user_password
  @email NVARCHAR(255),
  @name NVARCHAR(100),
  @phone NVARCHAR(30) = NULL,
  @password_hash NVARCHAR(255)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.users
  SET
    password_hash = @password_hash,
    updated_at = SYSUTCDATETIME()
  WHERE
    email = @email
    AND name = @name
    AND (
      NULLIF(phone, '') IS NULL
      OR phone = NULLIF(@phone, '')
    );

  SELECT CAST(CASE WHEN @@ROWCOUNT = 1 THEN 1 ELSE 0 END AS BIT) AS ok;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_user_profile
  @id UNIQUEIDENTIFIER,
  @name NVARCHAR(100),
  @phone NVARCHAR(30) = NULL,
  @marketing_consent BIT = 0,
  @password_hash NVARCHAR(255) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.users
  SET
    name = COALESCE(NULLIF(@name, ''), name),
    phone = NULLIF(@phone, ''),
    marketing_consent = @marketing_consent,
    password_hash = COALESCE(@password_hash, password_hash),
    updated_at = SYSUTCDATETIME()
  WHERE id = @id;

  EXEC dbo.app_get_user_by_id @id = @id;
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
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
    se.updated_at AS updatedAt
  FROM dbo.study_entries se
  INNER JOIN dbo.children c ON c.id = se.child_id
  WHERE se.user_id = @user_id
  ORDER BY se.study_date;
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

  DECLARE @existing_entries TABLE (
    child_id UNIQUEIDENTIFIER NOT NULL,
    book_id UNIQUEIDENTIFIER NOT NULL,
    study_date DATE NOT NULL,
    amount NVARCHAR(200) NULL,
    memo NVARCHAR(1000) NULL,
    completed BIT NOT NULL,
    reward_awarded BIT NOT NULL,
    reward_amount INT NOT NULL,
    reward_label NVARCHAR(50) NULL,
    reward_redeemed BIT NOT NULL,
    reward_redeemed_at DATETIME2(0) NULL,
    updated_at DATETIME2(0) NOT NULL
  );

  INSERT INTO @existing_child_passwords (id, login_id, password_hash)
  SELECT id, login_id, password_hash
  FROM dbo.children
  WHERE user_id = @user_id;

  INSERT INTO @existing_entries
    (child_id, book_id, study_date, amount, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, updated_at)
  SELECT
    child_id,
    book_id,
    study_date,
    amount,
    memo,
    completed,
    reward_awarded,
    reward_amount,
    reward_label,
    reward_redeemed,
    reward_redeemed_at,
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

  DELETE FROM dbo.study_entries WHERE user_id = @user_id;

  DELETE bsd
  FROM dbo.book_schedule_days bsd
  INNER JOIN dbo.books b ON b.id = bsd.book_id
  WHERE b.user_id = @user_id;

  DELETE FROM dbo.books WHERE user_id = @user_id;
  DELETE FROM dbo.subject_settings WHERE user_id = @user_id;
  DELETE FROM dbo.children WHERE user_id = @user_id;

  INSERT INTO dbo.children (id, user_id, name, birth_month, login_id, password_hash, sort_order)
  SELECT
    child.id,
    @user_id,
    child.name,
    TRY_CONVERT(date, NULLIF(child.birthMonth, '')),
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
    start_date NVARCHAR(10) NULL,
    end_date NVARCHAR(10) NULL,
    reward_enabled BIT NOT NULL,
    reward_amount INT NOT NULL,
    reward_label NVARCHAR(50) NULL,
    schedule_days NVARCHAR(MAX) NULL
  );

  INSERT INTO @books
    (id, child_id, subject_setting_id, name, schedule_time, start_date, end_date, reward_enabled, reward_amount, reward_label, schedule_days)
  SELECT
    book.id,
    TRY_CONVERT(uniqueidentifier, book.childId),
    book.subjectSettingId,
    book.book,
    NULLIF(book.scheduleTime, ''),
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
    startDate NVARCHAR(10) '$.startDate',
    endDate NVARCHAR(10) '$.endDate',
    rewardEnabled NVARCHAR(5) '$.rewardEnabled',
    rewardAmount NVARCHAR(20) '$.rewardAmount',
    rewardLabel NVARCHAR(50) '$.rewardLabel',
    scheduleDays NVARCHAR(MAX) '$.scheduleDays' AS JSON
  ) book
  WHERE
    book.id IS NOT NULL
    AND book.subjectSettingId IS NOT NULL
    AND NULLIF(book.book, '') IS NOT NULL;

  INSERT INTO dbo.books
    (id, user_id, child_id, subject_setting_id, name, schedule_time, start_date, end_date, reward_enabled, reward_amount, reward_label)
  SELECT
    id,
    @user_id,
    child_id,
    subject_setting_id,
    name,
    TRY_CONVERT(time(0), schedule_time),
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
    (user_id, child_id, book_id, study_date, amount, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, updated_at)
  SELECT
    @user_id,
    book.child_id,
    entry.bookId,
    TRY_CONVERT(date, entry.studyDate),
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.amount ELSE NULLIF(entry.amount, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.memo ELSE NULLIF(entry.memo, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.completed ELSE CASE WHEN entry.completed IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_awarded ELSE CASE WHEN entry.rewardAwarded IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_amount ELSE CASE WHEN TRY_CONVERT(int, entry.rewardAmount) > 0 THEN TRY_CONVERT(int, entry.rewardAmount) ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_label ELSE NULLIF(entry.rewardLabel, '') END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_redeemed ELSE CASE WHEN entry.rewardRedeemed IN ('true', '1') THEN 1 ELSE 0 END END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.reward_redeemed_at ELSE TRY_CONVERT(datetime2(0), NULLIF(entry.rewardRedeemedAt, '')) END,
    CASE WHEN existing.updated_at > COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), '19000101') THEN existing.updated_at ELSE COALESCE(TRY_CONVERT(datetime2(0), NULLIF(entry.updatedAt, '')), SYSUTCDATETIME()) END
  FROM OPENJSON(@state_json, '$.entriesList')
  WITH (
    bookId UNIQUEIDENTIFIER '$.bookId',
    studyDate NVARCHAR(10) '$.date',
    amount NVARCHAR(200) '$.amount',
    memo NVARCHAR(1000) '$.memo',
    completed NVARCHAR(5) '$.completed',
    rewardAwarded NVARCHAR(5) '$.rewardAwarded',
    rewardAmount NVARCHAR(20) '$.rewardAmount',
    rewardLabel NVARCHAR(50) '$.rewardLabel',
    rewardRedeemed NVARCHAR(5) '$.rewardRedeemed',
    rewardRedeemedAt NVARCHAR(40) '$.rewardRedeemedAt',
    updatedAt NVARCHAR(40) '$.updatedAt'
  ) entry
  INNER JOIN @books book ON book.id = entry.bookId
  LEFT JOIN @existing_entries existing
    ON existing.child_id = book.child_id
    AND existing.book_id = entry.bookId
    AND existing.study_date = TRY_CONVERT(date, entry.studyDate)
  WHERE entry.bookId IS NOT NULL AND TRY_CONVERT(date, entry.studyDate) IS NOT NULL;

  INSERT INTO dbo.study_entries
    (user_id, child_id, book_id, study_date, amount, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, updated_at)
  SELECT
    @user_id,
    existing.child_id,
    existing.book_id,
    existing.study_date,
    existing.amount,
    existing.memo,
    existing.completed,
    existing.reward_awarded,
    existing.reward_amount,
    existing.reward_label,
    existing.reward_redeemed,
    existing.reward_redeemed_at,
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
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
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
  @completed BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE
    @reward_enabled BIT,
    @reward_amount INT,
    @reward_label NVARCHAR(50),
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
    @reward_label = reward_label
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
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT
      (user_id, child_id, book_id, study_date, amount, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, updated_at)
    VALUES
      (@teacher_user_id, @child_id, @book_id, @study_date, NULLIF(@amount, ''), NULLIF(@memo, ''), @completed, @next_reward_awarded, @next_reward_amount, @next_reward_label, @next_reward_redeemed, @next_reward_redeemed_at, SYSUTCDATETIME());

  SELECT
    book_id AS bookId,
    study_date AS studyDate,
    amount,
    memo,
    completed,
    reward_awarded AS rewardAwarded,
    reward_amount AS rewardAmount,
    reward_label AS rewardLabel,
    reward_redeemed AS rewardRedeemed,
    reward_redeemed_at AS rewardRedeemedAt,
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
      memo = NULLIF(@memo, ''),
      completed = @completed,
      reward_awarded = @reward_awarded,
      reward_amount = CASE WHEN @reward_amount > 0 THEN @reward_amount ELSE 0 END,
      reward_label = NULLIF(@reward_label, ''),
      reward_redeemed = @reward_redeemed,
      reward_redeemed_at = @reward_redeemed_at,
      updated_at = COALESCE(@updated_at, SYSUTCDATETIME())
  WHEN NOT MATCHED THEN
    INSERT
      (user_id, child_id, book_id, study_date, amount, memo, completed, reward_awarded, reward_amount, reward_label, reward_redeemed, reward_redeemed_at, updated_at)
    VALUES
      (@user_id, @child_id, @book_id, @study_date, NULLIF(@amount, ''), NULLIF(@memo, ''), @completed, @reward_awarded, CASE WHEN @reward_amount > 0 THEN @reward_amount ELSE 0 END, NULLIF(@reward_label, ''), @reward_redeemed, @reward_redeemed_at, COALESCE(@updated_at, SYSUTCDATETIME()));

  SELECT
    c.name AS childName,
    se.book_id AS bookId,
    se.study_date AS studyDate,
    se.amount,
    se.memo,
    se.completed,
    se.reward_awarded AS rewardAwarded,
    se.reward_amount AS rewardAmount,
    se.reward_label AS rewardLabel,
    se.reward_redeemed AS rewardRedeemed,
    se.reward_redeemed_at AS rewardRedeemedAt,
    se.updated_at AS updatedAt
  FROM dbo.study_entries se
  INNER JOIN dbo.children c ON c.id = se.child_id
  WHERE se.user_id = @user_id AND se.child_id = @child_id AND se.book_id = @book_id AND se.study_date = @study_date;
END;
GO
