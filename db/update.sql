IF COL_LENGTH('dbo.books', 'minimum_study_minutes') IS NULL
  ALTER TABLE dbo.books ADD minimum_study_minutes INT NOT NULL CONSTRAINT DF_books_minimum_study_minutes DEFAULT (0) WITH VALUES;
GO

IF OBJECT_ID('dbo.subscription_plans', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.subscription_plans (
    plan_code NVARCHAR(30) NOT NULL CONSTRAINT PK_subscription_plans PRIMARY KEY,
    plan_name NVARCHAR(100) NOT NULL,
    monthly_price INT NOT NULL CONSTRAINT DF_subscription_plans_monthly_price DEFAULT (0),
    student_limit INT NOT NULL CONSTRAINT DF_subscription_plans_student_limit DEFAULT (0),
    gradient_from NVARCHAR(20) NULL,
    gradient_to NVARCHAR(20) NULL,
    sort_order INT NOT NULL CONSTRAINT DF_subscription_plans_sort_order DEFAULT (0),
    enabled BIT NOT NULL CONSTRAINT DF_subscription_plans_enabled DEFAULT (1),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_subscription_plans_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_subscription_plans_updated_at DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF COL_LENGTH('dbo.subscription_plans', 'gradient_from') IS NULL
  ALTER TABLE dbo.subscription_plans ADD gradient_from NVARCHAR(20) NULL;
GO

IF COL_LENGTH('dbo.subscription_plans', 'gradient_to') IS NULL
  ALTER TABLE dbo.subscription_plans ADD gradient_to NVARCHAR(20) NULL;
GO

MERGE dbo.subscription_plans AS target
USING (
  SELECT N'basic' AS plan_code, NCHAR(54532) + NCHAR(47532) AS plan_name, 0 AS monthly_price, 3 AS student_limit, N'#64748b' AS gradient_from, N'#94a3b8' AS gradient_to, 1 AS sort_order
  UNION ALL
  SELECT N'starter', NCHAR(46972) + NCHAR(51060) + NCHAR(53944), 5500, 20, N'#426f96', N'#2ba889', 2
  UNION ALL
  SELECT N'pro', NCHAR(49828) + NCHAR(53472) + NCHAR(45796) + NCHAR(46300), 11000, 100, N'#7c3aed', N'#e11d48', 3
  UNION ALL
  SELECT N'premium', NCHAR(54532) + NCHAR(47532) + NCHAR(48120) + NCHAR(50628), 22000, 300, N'#0f766e', N'#2563eb', 4
) AS source
ON target.plan_code = source.plan_code
WHEN MATCHED THEN
  UPDATE SET
    plan_name = source.plan_name,
    monthly_price = source.monthly_price,
    student_limit = source.student_limit,
    gradient_from = source.gradient_from,
    gradient_to = source.gradient_to,
    sort_order = source.sort_order,
    enabled = 1,
    updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (plan_code, plan_name, monthly_price, student_limit, gradient_from, gradient_to, sort_order, enabled)
  VALUES (source.plan_code, source.plan_name, source.monthly_price, source.student_limit, source.gradient_from, source.gradient_to, source.sort_order, 1);
GO

UPDATE dbo.subscription_plans
SET
  gradient_from = CASE WHEN plan_code = N'basic' THEN N'#64748b' WHEN plan_code = N'starter' THEN N'#426f96' WHEN plan_code = N'pro' THEN N'#7c3aed' WHEN plan_code = N'premium' THEN N'#0f766e' ELSE COALESCE(gradient_from, N'#426f96') END,
  gradient_to = CASE WHEN plan_code = N'basic' THEN N'#94a3b8' WHEN plan_code = N'starter' THEN N'#2ba889' WHEN plan_code = N'pro' THEN N'#e11d48' WHEN plan_code = N'premium' THEN N'#2563eb' ELSE COALESCE(gradient_to, N'#2ba889') END
WHERE gradient_from IS NULL OR gradient_to IS NULL;
GO

IF OBJECT_ID('dbo.subscription_plan_terms', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.subscription_plan_terms (
    plan_code NVARCHAR(30) NOT NULL,
    term_months INT NOT NULL,
    discount_rate DECIMAL(5,2) NOT NULL CONSTRAINT DF_subscription_plan_terms_discount_rate DEFAULT (0),
    enabled BIT NOT NULL CONSTRAINT DF_subscription_plan_terms_enabled DEFAULT (1),
    sort_order INT NOT NULL CONSTRAINT DF_subscription_plan_terms_sort_order DEFAULT (0),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_subscription_plan_terms_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_subscription_plan_terms_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_subscription_plan_terms PRIMARY KEY (plan_code, term_months),
    CONSTRAINT FK_subscription_plan_terms_subscription_plans FOREIGN KEY (plan_code) REFERENCES dbo.subscription_plans(plan_code) ON DELETE CASCADE
  );
END;
GO

MERGE dbo.subscription_plan_terms AS target
USING (
  SELECT N'starter' AS plan_code, 1 AS term_months, CAST(0 AS DECIMAL(5,2)) AS discount_rate, 1 AS sort_order
  UNION ALL
  SELECT N'starter', 3, CAST(5 AS DECIMAL(5,2)), 2
  UNION ALL
  SELECT N'starter', 6, CAST(10 AS DECIMAL(5,2)), 3
  UNION ALL
  SELECT N'starter', 12, CAST(15 AS DECIMAL(5,2)), 4
  UNION ALL
  SELECT N'pro', 1, CAST(0 AS DECIMAL(5,2)), 1
  UNION ALL
  SELECT N'pro', 3, CAST(5 AS DECIMAL(5,2)), 2
  UNION ALL
  SELECT N'pro', 6, CAST(10 AS DECIMAL(5,2)), 3
  UNION ALL
  SELECT N'pro', 12, CAST(15 AS DECIMAL(5,2)), 4
  UNION ALL
  SELECT N'premium', 1, CAST(0 AS DECIMAL(5,2)), 1
  UNION ALL
  SELECT N'premium', 3, CAST(5 AS DECIMAL(5,2)), 2
  UNION ALL
  SELECT N'premium', 6, CAST(10 AS DECIMAL(5,2)), 3
  UNION ALL
  SELECT N'premium', 12, CAST(15 AS DECIMAL(5,2)), 4
) AS source
ON target.plan_code = source.plan_code AND target.term_months = source.term_months
WHEN MATCHED THEN
  UPDATE SET
    discount_rate = source.discount_rate,
    sort_order = source.sort_order,
    enabled = 1,
    updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (plan_code, term_months, discount_rate, sort_order, enabled)
  VALUES (source.plan_code, source.term_months, source.discount_rate, source.sort_order, 1);
GO

IF COL_LENGTH('dbo.users', 'plan_code') IS NULL
  ALTER TABLE dbo.users ADD plan_code NVARCHAR(30) NOT NULL CONSTRAINT DF_users_plan_code DEFAULT (N'basic') WITH VALUES;
GO

IF COL_LENGTH('dbo.users', 'service_started_at') IS NULL
  ALTER TABLE dbo.users ADD service_started_at DATETIME2(0) NOT NULL CONSTRAINT DF_users_service_started_at DEFAULT SYSUTCDATETIME() WITH VALUES;
GO

IF COL_LENGTH('dbo.users', 'service_ends_at') IS NULL
  ALTER TABLE dbo.users ADD service_ends_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.users', 'profile_image_path') IS NULL
  ALTER TABLE dbo.users ADD profile_image_path NVARCHAR(1000) NULL;
GO

IF COL_LENGTH('dbo.users', 'teacher_comment') IS NULL
  ALTER TABLE dbo.users ADD teacher_comment NVARCHAR(200) NULL;
GO

UPDATE dbo.users
SET plan_code = N'basic'
WHERE plan_code IS NULL OR NOT EXISTS (
  SELECT 1 FROM dbo.subscription_plans WHERE plan_code = dbo.users.plan_code
);
GO

UPDATE dbo.users
SET service_ends_at = NULL
WHERE plan_code = N'basic' AND service_ends_at IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = N'FK_users_subscription_plans'
    AND parent_object_id = OBJECT_ID(N'dbo.users')
)
BEGIN
  ALTER TABLE dbo.users
    ADD CONSTRAINT FK_users_subscription_plans FOREIGN KEY (plan_code) REFERENCES dbo.subscription_plans(plan_code);
END;
GO

IF OBJECT_ID('dbo.user_plan_histories', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_plan_histories (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_user_plan_histories PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NOT NULL,
    from_plan_code NVARCHAR(30) NULL,
    to_plan_code NVARCHAR(30) NOT NULL,
    changed_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_plan_histories_changed_at DEFAULT SYSUTCDATETIME(),
    memo NVARCHAR(200) NULL
  );

  CREATE INDEX IX_user_plan_histories_user ON dbo.user_plan_histories(user_id, changed_at DESC);
END;
GO

IF OBJECT_ID('dbo.payment_orders', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.payment_orders (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payment_orders PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NOT NULL,
    payment_provider NVARCHAR(20) NOT NULL CONSTRAINT DF_payment_orders_payment_provider DEFAULT (N'toss'),
    order_id NVARCHAR(64) NOT NULL,
    plan_code NVARCHAR(30) NOT NULL,
    order_name NVARCHAR(100) NOT NULL,
    amount INT NOT NULL,
    term_months INT NOT NULL CONSTRAINT DF_payment_orders_term_months DEFAULT (1),
    base_amount INT NOT NULL CONSTRAINT DF_payment_orders_base_amount DEFAULT (0),
    discount_rate DECIMAL(5,2) NOT NULL CONSTRAINT DF_payment_orders_discount_rate DEFAULT (0),
    discount_amount INT NOT NULL CONSTRAINT DF_payment_orders_discount_amount DEFAULT (0),
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_payment_orders_status DEFAULT (N'READY'),
    payment_key NVARCHAR(200) NULL,
    payment_method NVARCHAR(50) NULL,
    requested_at DATETIME2(0) NOT NULL CONSTRAINT DF_payment_orders_requested_at DEFAULT SYSUTCDATETIME(),
    approved_at DATETIME2(0) NULL,
    completed_at DATETIME2(0) NULL,
    service_revoked_at DATETIME2(0) NULL,
    raw_response NVARCHAR(MAX) NULL
  );

  CREATE UNIQUE INDEX UX_payment_orders_order_id ON dbo.payment_orders(order_id);
  CREATE INDEX IX_payment_orders_user ON dbo.payment_orders(user_id, requested_at DESC);
END;
GO

IF COL_LENGTH('dbo.payment_orders', 'payment_provider') IS NULL
  ALTER TABLE dbo.payment_orders ADD payment_provider NVARCHAR(20) NOT NULL CONSTRAINT DF_payment_orders_payment_provider DEFAULT (N'toss') WITH VALUES;
GO

IF COL_LENGTH('dbo.payment_orders', 'term_months') IS NULL
  ALTER TABLE dbo.payment_orders ADD term_months INT NOT NULL CONSTRAINT DF_payment_orders_term_months DEFAULT (1) WITH VALUES;
GO

IF COL_LENGTH('dbo.payment_orders', 'base_amount') IS NULL
  ALTER TABLE dbo.payment_orders ADD base_amount INT NOT NULL CONSTRAINT DF_payment_orders_base_amount DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.payment_orders', 'discount_rate') IS NULL
  ALTER TABLE dbo.payment_orders ADD discount_rate DECIMAL(5,2) NOT NULL CONSTRAINT DF_payment_orders_discount_rate DEFAULT (0) WITH VALUES;
GO

IF COL_LENGTH('dbo.payment_orders', 'discount_amount') IS NULL
  ALTER TABLE dbo.payment_orders ADD discount_amount INT NOT NULL CONSTRAINT DF_payment_orders_discount_amount DEFAULT (0) WITH VALUES;
GO

UPDATE dbo.payment_orders
SET base_amount = amount
WHERE base_amount = 0 AND amount > 0;
GO

IF COL_LENGTH('dbo.payment_orders', 'service_started_at') IS NULL
  ALTER TABLE dbo.payment_orders ADD service_started_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payment_orders', 'service_ends_at') IS NULL
  ALTER TABLE dbo.payment_orders ADD service_ends_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payment_orders', 'service_revoked_at') IS NULL
  ALTER TABLE dbo.payment_orders ADD service_revoked_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payment_orders', 'refunded_amount') IS NULL
  ALTER TABLE dbo.payment_orders ADD refunded_amount INT NOT NULL CONSTRAINT DF_payment_orders_refunded_amount DEFAULT (0) WITH VALUES;
GO

UPDATE po
SET service_revoked_at = free_change.changed_at
FROM dbo.payment_orders po
CROSS APPLY (
  SELECT TOP (1) hist.changed_at
  FROM dbo.user_plan_histories hist
  WHERE hist.user_id = po.user_id
    AND hist.to_plan_code = N'basic'
    AND hist.changed_at > COALESCE(po.completed_at, po.approved_at, po.requested_at)
    AND hist.changed_at < COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at)))
  ORDER BY hist.changed_at
) free_change
WHERE po.status = N'DONE'
  AND po.service_revoked_at IS NULL;
GO

UPDATE po
SET service_revoked_at = plan_change.changed_at
FROM dbo.payment_orders po
CROSS APPLY (
  SELECT TOP (1) hist.changed_at
  FROM dbo.user_plan_histories hist
  WHERE hist.user_id = po.user_id
    AND hist.from_plan_code = po.plan_code
    AND hist.to_plan_code <> po.plan_code
    AND hist.changed_at > COALESCE(po.completed_at, po.approved_at, po.requested_at)
    AND hist.changed_at < COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at)))
  ORDER BY hist.changed_at
) plan_change
WHERE po.status = N'DONE'
  AND po.service_revoked_at IS NULL;
GO

IF COL_LENGTH('dbo.payment_orders', 'refunded_at') IS NULL
  ALTER TABLE dbo.payment_orders ADD refunded_at DATETIME2(0) NULL;
GO

IF COL_LENGTH('dbo.payment_orders', 'refund_response') IS NULL
  ALTER TABLE dbo.payment_orders ADD refund_response NVARCHAR(MAX) NULL;
GO

IF OBJECT_ID('dbo.payment_refunds', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.payment_refunds (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_payment_refunds PRIMARY KEY,
    payment_order_id BIGINT NOT NULL,
    user_id UNIQUEIDENTIFIER NOT NULL,
    payment_provider NVARCHAR(20) NOT NULL,
    order_id NVARCHAR(64) NOT NULL,
    payment_key NVARCHAR(200) NOT NULL,
    refund_amount INT NOT NULL,
    reason NVARCHAR(200) NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_payment_refunds_status DEFAULT (N'DONE'),
    requested_at DATETIME2(0) NOT NULL CONSTRAINT DF_payment_refunds_requested_at DEFAULT SYSUTCDATETIME(),
    processed_at DATETIME2(0) NULL,
    raw_response NVARCHAR(MAX) NULL
  );

  CREATE INDEX IX_payment_refunds_user ON dbo.payment_refunds(user_id, requested_at DESC);
END;
GO

UPDATE dbo.payment_orders
SET status = N'DONE'
WHERE status = N'REFUNDED';
GO

UPDATE po
SET
  refunded_amount = 0,
  refunded_at = NULL,
  refund_response = NULL
FROM dbo.payment_orders po
WHERE EXISTS (
  SELECT 1
  FROM dbo.payment_refunds pr
  WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
);
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

IF COL_LENGTH('dbo.children', 'status') IS NULL
  ALTER TABLE dbo.children ADD status NVARCHAR(20) NOT NULL CONSTRAINT DF_children_status DEFAULT (N'active') WITH VALUES;
GO

UPDATE dbo.children
SET status = N'active'
WHERE status IS NULL OR status NOT IN (N'active', N'hidden');
GO

IF OBJECT_ID('dbo.UQ_children_user_login_id', 'UQ') IS NOT NULL
BEGIN
  ALTER TABLE dbo.children DROP CONSTRAINT UQ_children_user_login_id;
END;
GO

IF EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.children')
    AND name = N'UQ_children_user_login_id'
    AND is_unique_constraint = 0
)
BEGIN
  DROP INDEX UQ_children_user_login_id ON dbo.children;
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.children')
    AND name = N'UX_children_user_login_id'
)
BEGIN
  CREATE UNIQUE INDEX UX_children_user_login_id
    ON dbo.children(user_id, login_id)
    WHERE login_id IS NOT NULL;
END;
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
    marketingConsent BIT NOT NULL,
    planCode NVARCHAR(30) NOT NULL,
    planName NVARCHAR(100) NOT NULL,
    monthlyPrice INT NOT NULL,
    studentLimit INT NOT NULL,
    serviceStartedAt DATETIME2(0) NOT NULL,
    serviceEndsAt DATETIME2(0) NULL
  );

  BEGIN TRANSACTION;

  INSERT INTO dbo.users (email, password_hash, name, phone, marketing_consent, plan_code, service_started_at)
  OUTPUT
    inserted.id,
    inserted.email,
    inserted.name,
    inserted.phone,
    inserted.marketing_consent,
    inserted.plan_code,
    N'',
    0,
    0,
    inserted.service_started_at,
    inserted.service_ends_at
  INTO @created_user
  VALUES (@email, @password_hash, @name, @phone, @marketing_consent, N'basic', SYSUTCDATETIME());

  UPDATE created
  SET
    planName = plan_info.plan_name,
    monthlyPrice = plan_info.monthly_price,
    studentLimit = plan_info.student_limit
  FROM @created_user created
  INNER JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = created.planCode;

  INSERT INTO dbo.subject_settings (user_id, name, color, sort_order)
  SELECT created.id, defaults.name, defaults.color, defaults.sort_order
  FROM @created_user created
  CROSS APPLY (VALUES
    (N'援?뼱', '#ef6461', 0),
    (N'?곸뼱', '#20a779', 1),
    (N'?섑븰', '#2f78d4', 2)
  ) defaults(name, color, sort_order);

  COMMIT TRANSACTION;

  SELECT
    id,
    email,
    name,
    phone,
    marketingConsent,
    planCode,
    planName,
    monthlyPrice,
    studentLimit,
    serviceStartedAt,
    serviceEndsAt
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
    marketing_consent AS marketingConsent,
    u.plan_code AS planCode,
    plan_info.plan_name AS planName,
    plan_info.monthly_price AS monthlyPrice,
    plan_info.student_limit AS studentLimit,
    plan_info.gradient_from AS gradientFrom,
    plan_info.gradient_to AS gradientTo,
    u.service_started_at AS serviceStartedAt,
    u.service_ends_at AS serviceEndsAt,
    u.profile_image_path AS profileImagePath,
    u.teacher_comment AS teacherComment
  FROM dbo.users u
  LEFT JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = u.plan_code
  WHERE u.email = @email;
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
    marketing_consent AS marketingConsent,
    u.plan_code AS planCode,
    plan_info.plan_name AS planName,
    plan_info.monthly_price AS monthlyPrice,
    plan_info.student_limit AS studentLimit,
    plan_info.gradient_from AS gradientFrom,
    plan_info.gradient_to AS gradientTo,
    u.service_started_at AS serviceStartedAt,
    u.service_ends_at AS serviceEndsAt,
    u.profile_image_path AS profileImagePath,
    u.teacher_comment AS teacherComment
  FROM dbo.users u
  LEFT JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = u.plan_code
  WHERE u.id = @id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_subscription_plans
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    plan_code AS planCode,
    plan_name AS planName,
    monthly_price AS monthlyPrice,
    student_limit AS studentLimit,
    gradient_from AS gradientFrom,
    gradient_to AS gradientTo,
    sort_order AS sortOrder
  FROM dbo.subscription_plans
  WHERE enabled = 1
  ORDER BY sort_order, monthly_price, plan_code;

  SELECT
    term.plan_code AS planCode,
    term.term_months AS termMonths,
    term.discount_rate AS discountRate,
    term.sort_order AS sortOrder
  FROM dbo.subscription_plan_terms term
  INNER JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = term.plan_code
  WHERE term.enabled = 1
    AND plan_info.enabled = 1
    AND plan_info.monthly_price > 0
  ORDER BY term.plan_code, term.sort_order, term.term_months;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_change_user_plan
  @user_id UNIQUEIDENTIFIER,
  @plan_code NVARCHAR(30),
  @service_ends_at DATETIME2(0) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @current_plan_code NVARCHAR(30);
  DECLARE @current_service_ends_at DATETIME2(0);
  DECLARE @effective_service_ends_at DATETIME2(0);
  DECLARE @monthly_price INT;
  DECLARE @student_limit INT;
  DECLARE @child_count INT;

  SELECT
    @current_plan_code = plan_code,
    @current_service_ends_at = service_ends_at
  FROM dbo.users
  WHERE id = @user_id;

  IF @current_plan_code IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'user_not_found' AS errorCode;
    RETURN;
  END;

  SELECT
    @student_limit = student_limit,
    @monthly_price = monthly_price
  FROM dbo.subscription_plans
  WHERE plan_code = @plan_code AND enabled = 1;

  IF @student_limit IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'plan_not_found' AS errorCode;
    RETURN;
  END;

  SET @effective_service_ends_at = CASE WHEN ISNULL(@monthly_price, 0) <= 0 THEN NULL ELSE @service_ends_at END;

  SELECT @child_count = COUNT(1)
  FROM dbo.children
  WHERE user_id = @user_id;

  IF @student_limit > 0 AND @child_count > @student_limit
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'student_limit_exceeded' AS errorCode, @student_limit AS studentLimit, @child_count AS childCount;
    RETURN;
  END;

  IF ISNULL(@monthly_price, 0) <= 0
  BEGIN
    BEGIN TRANSACTION;

    IF @current_plan_code <> @plan_code
      OR @current_service_ends_at IS NOT NULL
    BEGIN
      UPDATE dbo.users
      SET
        plan_code = @plan_code,
        service_started_at = SYSUTCDATETIME(),
        service_ends_at = NULL,
        updated_at = SYSUTCDATETIME()
      WHERE id = @user_id;

      UPDATE po
      SET service_revoked_at = SYSUTCDATETIME()
      FROM dbo.payment_orders po
      WHERE po.user_id = @user_id
        AND po.status = N'DONE'
        AND po.service_revoked_at IS NULL
        AND COALESCE(po.service_started_at, po.approved_at, po.completed_at) < SYSUTCDATETIME()
        AND COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) > SYSUTCDATETIME()
        AND NOT EXISTS (
          SELECT 1
          FROM dbo.payment_refunds pr
          WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
        );

      INSERT INTO dbo.user_plan_histories (user_id, from_plan_code, to_plan_code, memo)
      VALUES (@user_id, @current_plan_code, @plan_code, N'manual_change_free');
    END;

    COMMIT TRANSACTION;

    SELECT CAST(1 AS BIT) AS ok, CAST(NULL AS NVARCHAR(50)) AS errorCode;
    EXEC dbo.app_get_user_by_id @id = @user_id;
    RETURN;
  END;

  BEGIN TRANSACTION;

  IF @current_plan_code <> @plan_code
    OR ISNULL(@current_service_ends_at, '19000101') <> ISNULL(@effective_service_ends_at, '19000101')
  BEGIN
    UPDATE dbo.users
    SET
      plan_code = @plan_code,
      service_started_at = CASE WHEN @current_plan_code <> @plan_code THEN SYSUTCDATETIME() ELSE service_started_at END,
      service_ends_at = @effective_service_ends_at,
      updated_at = SYSUTCDATETIME()
    WHERE id = @user_id;

    INSERT INTO dbo.user_plan_histories (user_id, from_plan_code, to_plan_code, memo)
    VALUES (@user_id, @current_plan_code, @plan_code, N'manual_change');
  END;

  COMMIT TRANSACTION;

  SELECT CAST(1 AS BIT) AS ok, CAST(NULL AS NVARCHAR(50)) AS errorCode;
  EXEC dbo.app_get_user_by_id @id = @user_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_create_payment_order
  @user_id UNIQUEIDENTIFIER,
  @payment_provider NVARCHAR(20),
  @plan_code NVARCHAR(30),
  @order_id NVARCHAR(64),
  @order_name NVARCHAR(100),
  @term_months INT = 1
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @amount INT;
  DECLARE @monthly_price INT;
  DECLARE @base_amount INT;
  DECLARE @discount_rate DECIMAL(5,2);
  DECLARE @discount_amount INT;
  DECLARE @plan_name NVARCHAR(100);
  DECLARE @student_limit INT;
  DECLARE @child_count INT;
  DECLARE @final_order_name NVARCHAR(100);

  SET @term_months = ISNULL(NULLIF(@term_months, 0), 1);

  SELECT
    @monthly_price = monthly_price,
    @plan_name = plan_name,
    @student_limit = student_limit
  FROM dbo.subscription_plans
  WHERE plan_code = @plan_code AND enabled = 1;

  IF @monthly_price IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'plan_not_found' AS errorCode;
    RETURN;
  END;

  IF @monthly_price <= 0
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'free_plan' AS errorCode;
    RETURN;
  END;

  SELECT
    @discount_rate = discount_rate
  FROM dbo.subscription_plan_terms
  WHERE plan_code = @plan_code
    AND term_months = @term_months
    AND enabled = 1;

  IF @discount_rate IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'term_not_found' AS errorCode;
    RETURN;
  END;

  SELECT @child_count = COUNT(1)
  FROM dbo.children
  WHERE user_id = @user_id;

  IF @student_limit > 0 AND @child_count > @student_limit
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'student_limit_exceeded' AS errorCode, @student_limit AS studentLimit, @child_count AS childCount;
    RETURN;
  END;

  SET @base_amount = @monthly_price * @term_months;
  SET @discount_amount = CAST(ROUND(@base_amount * @discount_rate / 100, 0) AS INT);
  SET @amount = @base_amount - @discount_amount;

  SET @final_order_name = COALESCE(
    NULLIF(@order_name, ''),
    NCHAR(49828) + NCHAR(53552) + NCHAR(46356) + NCHAR(54540) + NCHAR(47196) + NCHAR(50864) + N' ' +
      @plan_name + N' ' + CAST(@term_months AS NVARCHAR(10)) + NCHAR(44060) + NCHAR(50900) + N' ' + NCHAR(51060) + NCHAR(50857) + NCHAR(44428)
  );

  INSERT INTO dbo.payment_orders (
    user_id,
    payment_provider,
    order_id,
    plan_code,
    order_name,
    amount,
    term_months,
    base_amount,
    discount_rate,
    discount_amount
  )
  VALUES (
    @user_id,
    NULLIF(@payment_provider, ''),
    @order_id,
    @plan_code,
    @final_order_name,
    @amount,
    @term_months,
    @base_amount,
    @discount_rate,
    @discount_amount
  );

  SELECT
    CAST(1 AS BIT) AS ok,
    CAST(NULL AS NVARCHAR(50)) AS errorCode,
    @order_id AS orderId,
    @final_order_name AS orderName,
    @amount AS amount,
    @term_months AS termMonths,
    @base_amount AS baseAmount,
    @discount_rate AS discountRate,
    @discount_amount AS discountAmount,
    @plan_code AS planCode,
    NULLIF(@payment_provider, '') AS paymentProvider;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_payment_order
  @user_id UNIQUEIDENTIFIER,
  @order_id NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP (1)
    po.id,
    po.user_id AS userId,
    po.payment_provider AS paymentProvider,
    po.order_id AS orderId,
    po.plan_code AS planCode,
    sp.plan_name AS planName,
    sp.student_limit AS studentLimit,
    po.order_name AS orderName,
    po.amount,
    po.term_months AS termMonths,
    po.base_amount AS baseAmount,
    po.discount_rate AS discountRate,
    po.discount_amount AS discountAmount,
    po.status,
    po.payment_key AS paymentKey,
    po.payment_method AS paymentMethod,
    po.requested_at AS requestedAt,
    po.approved_at AS approvedAt,
    po.completed_at AS completedAt,
    COALESCE(po.service_started_at, po.approved_at, po.completed_at) AS serviceStartedAt,
    COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) AS serviceEndsAt,
    COALESCE(refunds.refundedAmount, 0) AS refundedAmount,
    refunds.refundedAt
  FROM dbo.payment_orders po
  INNER JOIN dbo.subscription_plans sp ON sp.plan_code = po.plan_code
  OUTER APPLY (
    SELECT
      SUM(pr.refund_amount) AS refundedAmount,
      MAX(COALESCE(pr.processed_at, pr.requested_at)) AS refundedAt
    FROM dbo.payment_refunds pr
    WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
  ) refunds
  WHERE po.user_id = @user_id AND po.order_id = @order_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_complete_payment_order
  @user_id UNIQUEIDENTIFIER,
  @order_id NVARCHAR(64),
  @payment_key NVARCHAR(200),
  @payment_method NVARCHAR(50) = NULL,
  @approved_at DATETIME2(0) = NULL,
  @raw_response NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @plan_code NVARCHAR(30);
  DECLARE @term_months INT;
  DECLARE @current_plan_code NVARCHAR(30);
  DECLARE @current_service_ends_at DATETIME2(0);
  DECLARE @service_base_at DATETIME2(0);
  DECLARE @service_ends_at DATETIME2(0);

  SELECT
    @plan_code = plan_code,
    @term_months = ISNULL(NULLIF(term_months, 0), 1)
  FROM dbo.payment_orders
  WHERE user_id = @user_id AND order_id = @order_id AND status IN (N'READY', N'IN_PROGRESS');

  IF @plan_code IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'order_not_found' AS errorCode;
    RETURN;
  END;

  SELECT
    @current_plan_code = plan_code,
    @current_service_ends_at = service_ends_at
  FROM dbo.users
  WHERE id = @user_id;

  SET @service_base_at = CASE
    WHEN @current_plan_code = @plan_code AND @current_service_ends_at > SYSUTCDATETIME() THEN @current_service_ends_at
    ELSE SYSUTCDATETIME()
  END;
  SET @service_ends_at = DATEADD(MONTH, @term_months, @service_base_at);

  BEGIN TRANSACTION;

  IF @current_plan_code <> @plan_code
  BEGIN
    UPDATE po
    SET service_revoked_at = @service_base_at
    FROM dbo.payment_orders po
    WHERE po.user_id = @user_id
      AND po.status = N'DONE'
      AND po.plan_code <> @plan_code
      AND po.service_revoked_at IS NULL
      AND COALESCE(po.service_started_at, po.approved_at, po.completed_at) < @service_base_at
      AND COALESCE(po.service_ends_at, DATEADD(MONTH, ISNULL(NULLIF(po.term_months, 0), 1), COALESCE(po.approved_at, po.completed_at))) > @service_base_at
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.payment_refunds pr
        WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
      );
  END;

  UPDATE dbo.payment_orders
  SET
    status = N'DONE',
    payment_key = @payment_key,
    payment_method = NULLIF(@payment_method, ''),
    approved_at = COALESCE(@approved_at, SYSUTCDATETIME()),
    completed_at = SYSUTCDATETIME(),
    service_started_at = @service_base_at,
    service_ends_at = @service_ends_at,
    raw_response = @raw_response
  WHERE user_id = @user_id AND order_id = @order_id;

  UPDATE dbo.users
  SET
    plan_code = @plan_code,
    service_started_at = CASE WHEN @current_plan_code <> @plan_code THEN SYSUTCDATETIME() ELSE service_started_at END,
    service_ends_at = @service_ends_at,
    updated_at = SYSUTCDATETIME()
  WHERE id = @user_id;

  INSERT INTO dbo.user_plan_histories (user_id, from_plan_code, to_plan_code, memo)
  VALUES (@user_id, @current_plan_code, @plan_code, N'toss_payment');

  COMMIT TRANSACTION;

  SELECT CAST(1 AS BIT) AS ok, CAST(NULL AS NVARCHAR(50)) AS errorCode;
  EXEC dbo.app_get_user_by_id @id = @user_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_refundable_payment_order
  @user_id UNIQUEIDENTIFIER,
  @order_id NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @now DATETIME2(0) = SYSUTCDATETIME();

  SELECT TOP (1)
    po.id AS paymentOrderId,
    po.payment_provider AS paymentProvider,
    po.order_id AS orderId,
    po.payment_key AS paymentKey,
    po.payment_method AS paymentMethod,
    po.amount,
    COALESCE(refunds.refundedAmount, 0) AS refundedAmount,
    COALESCE(po.service_started_at, po.approved_at, po.completed_at) AS serviceStartedAt,
    COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at))) AS serviceEndsAt,
    u.service_ends_at AS currentServiceEndsAt,
    CASE
      WHEN po.status <> N'DONE' THEN N'not_paid'
      WHEN COALESCE(refunds.refundedAmount, 0) > 0 THEN N'already_refunded'
      WHEN po.payment_key IS NULL OR po.payment_key = N'' THEN N'missing_payment_key'
      WHEN COALESCE(po.service_started_at, po.approved_at, po.completed_at) IS NULL THEN N'missing_service_period'
      WHEN @now >= COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at))) THEN N'expired'
      WHEN u.service_ends_at IS NULL OR ABS(DATEDIFF(SECOND, u.service_ends_at, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at))))) > 60 THEN N'not_current_period'
      ELSE NULL
    END AS errorCode,
    CASE
      WHEN @now < COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))
       AND DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, COALESCE(po.service_started_at, po.approved_at, po.completed_at)) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE)) > 0
      THEN
        CASE
          WHEN DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, @now) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE)) <= 0 THEN 0
          WHEN DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, @now) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE))
             >= DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, COALESCE(po.service_started_at, po.approved_at, po.completed_at)) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE))
          THEN po.amount - COALESCE(refunds.refundedAmount, 0)
          ELSE FLOOR(
            CAST(po.amount - COALESCE(refunds.refundedAmount, 0) AS FLOAT)
            * DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, @now) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE))
            / NULLIF(DATEDIFF(DAY, CAST(DATEADD(HOUR, 9, COALESCE(po.service_started_at, po.approved_at, po.completed_at)) AS DATE), CAST(DATEADD(HOUR, 9, COALESCE(po.service_ends_at, DATEADD(MONTH, 1, COALESCE(po.approved_at, po.completed_at)))) AS DATE)), 0)
          )
        END
      ELSE 0
    END AS refundAmount
  FROM dbo.payment_orders po
  INNER JOIN dbo.users u ON u.id = po.user_id
  OUTER APPLY (
    SELECT SUM(pr.refund_amount) AS refundedAmount
    FROM dbo.payment_refunds pr
    WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
  ) refunds
  WHERE po.user_id = @user_id AND po.order_id = @order_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_complete_payment_refund
  @user_id UNIQUEIDENTIFIER,
  @order_id NVARCHAR(64),
  @refund_amount INT,
  @reason NVARCHAR(200) = NULL,
  @raw_response NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @payment_order_id BIGINT;
  DECLARE @payment_provider NVARCHAR(20);
  DECLARE @payment_key NVARCHAR(200);
  DECLARE @current_plan_code NVARCHAR(30);
  DECLARE @service_revoked_at DATETIME2(0);
  DECLARE @order_service_ends_at DATETIME2(0);

  SELECT
    @payment_order_id = po.id,
    @payment_provider = po.payment_provider,
    @payment_key = po.payment_key,
    @service_revoked_at = po.service_revoked_at,
    @order_service_ends_at = po.service_ends_at
  FROM dbo.payment_orders po
  WHERE po.user_id = @user_id
    AND po.order_id = @order_id
    AND po.status = N'DONE'
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.payment_refunds pr
      WHERE pr.payment_order_id = po.id AND pr.status = N'DONE'
    );

  IF @payment_order_id IS NULL
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'order_not_refundable' AS errorCode;
    RETURN;
  END;

  IF @refund_amount <= 0
  BEGIN
    SELECT CAST(0 AS BIT) AS ok, N'no_refund_amount' AS errorCode;
    RETURN;
  END;

  SELECT @current_plan_code = plan_code
  FROM dbo.users
  WHERE id = @user_id;

  BEGIN TRANSACTION;

  INSERT INTO dbo.payment_refunds (
    payment_order_id,
    user_id,
    payment_provider,
    order_id,
    payment_key,
    refund_amount,
    reason,
    status,
    processed_at,
    raw_response
  )
  VALUES (
    @payment_order_id,
    @user_id,
    @payment_provider,
    @order_id,
    @payment_key,
    @refund_amount,
    NULLIF(@reason, ''),
    N'DONE',
    SYSUTCDATETIME(),
    @raw_response
  );

  UPDATE dbo.users
  SET
    service_ends_at = CASE
      WHEN @service_revoked_at IS NULL
        AND service_ends_at IS NOT NULL
        AND (@order_service_ends_at IS NULL OR ABS(DATEDIFF(SECOND, service_ends_at, @order_service_ends_at)) <= 60)
      THEN SYSUTCDATETIME()
      ELSE service_ends_at
    END,
    updated_at = SYSUTCDATETIME()
  WHERE id = @user_id;

  INSERT INTO dbo.user_plan_histories (user_id, from_plan_code, to_plan_code, memo)
  VALUES (@user_id, @current_plan_code, @current_plan_code, N'payment_refund');

  COMMIT TRANSACTION;

  SELECT CAST(1 AS BIT) AS ok, CAST(NULL AS NVARCHAR(50)) AS errorCode, @refund_amount AS refundAmount;
  EXEC dbo.app_get_user_by_id @id = @user_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_user_profile
  @id UNIQUEIDENTIFIER,
  @name NVARCHAR(100),
  @phone NVARCHAR(30) = NULL,
  @marketing_consent BIT = 0,
  @teacher_comment NVARCHAR(200) = NULL,
  @password_hash NVARCHAR(255) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.users
  SET
    name = COALESCE(NULLIF(@name, ''), name),
    phone = NULLIF(@phone, ''),
    marketing_consent = @marketing_consent,
    teacher_comment = NULLIF(@teacher_comment, ''),
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
    u.name,
    u.email,
    u.phone,
    u.marketing_consent AS marketingConsent,
    u.plan_code AS planCode,
    plan_info.plan_name AS planName,
    plan_info.monthly_price AS monthlyPrice,
    plan_info.student_limit AS studentLimit,
    plan_info.gradient_from AS gradientFrom,
    plan_info.gradient_to AS gradientTo,
    u.service_started_at AS serviceStartedAt,
    u.service_ends_at AS serviceEndsAt,
    u.profile_image_path AS profileImagePath,
    u.teacher_comment AS teacherComment
  FROM dbo.users u
  LEFT JOIN dbo.subscription_plans plan_info ON plan_info.plan_code = u.plan_code
  WHERE u.id = @user_id;

  SELECT
    id,
    name,
    birth_month AS birthMonth,
    phone,
    parent_phone AS parentPhone,
    status,
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
    se.child_id AS childId,
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
    teacher_comment = CASE
      WHEN JSON_VALUE(@state_json, '$.profile.teacherComment') IS NULL THEN teacher_comment
      ELSE NULLIF(LEFT(JSON_VALUE(@state_json, '$.profile.teacherComment'), 200), '')
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

  INSERT INTO dbo.children (id, user_id, name, birth_month, phone, parent_phone, status, login_id, password_hash, sort_order)
  SELECT
    child.id,
    @user_id,
    child.name,
    TRY_CONVERT(date, NULLIF(child.birthMonth, '')),
    NULLIF(child.phone, ''),
    NULLIF(child.parentPhone, ''),
    CASE WHEN child.status = N'hidden' THEN N'hidden' ELSE N'active' END,
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
    status NVARCHAR(20) '$.status',
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
    u.name AS teacherName,
    u.profile_image_path AS teacherProfileImagePath,
    u.teacher_comment AS teacherComment
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
  @child_id UNIQUEIDENTIFIER = NULL,
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

  IF @child_id IS NULL
  BEGIN
    SELECT @child_id = id
    FROM dbo.children
    WHERE user_id = @user_id AND name = @child_name;
  END;

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

IF OBJECT_ID('dbo.study_entry_attachments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.study_entry_attachments (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_study_entry_attachments_id DEFAULT NEWID() PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NOT NULL,
    child_id UNIQUEIDENTIFIER NOT NULL,
    book_id UNIQUEIDENTIFIER NOT NULL,
    study_date DATE NOT NULL,
    original_name NVARCHAR(255) NOT NULL,
    stored_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(1000) NOT NULL,
    mime_type NVARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    ai_status NVARCHAR(20) NOT NULL CONSTRAINT DF_study_entry_attachments_ai_status DEFAULT (N'none'),
    ai_result NVARCHAR(MAX) NULL,
    ai_analyzed_at DATETIME2(0) NULL,
    teacher_viewed_at DATETIME2(0) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_study_entry_attachments_created_at DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_study_entry_attachments_entry ON dbo.study_entry_attachments(user_id, child_id, book_id, study_date, created_at);
END;
GO

IF COL_LENGTH('dbo.study_entry_attachments', 'teacher_viewed_at') IS NULL
BEGIN
  ALTER TABLE dbo.study_entry_attachments ADD teacher_viewed_at DATETIME2(0) NULL;
END;
GO

IF OBJECT_ID('dbo.study_entry_ai_analyses', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.study_entry_ai_analyses (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_study_entry_ai_analyses_id DEFAULT NEWID() PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NOT NULL,
    child_id UNIQUEIDENTIFIER NOT NULL,
    book_id UNIQUEIDENTIFIER NOT NULL,
    study_date DATE NOT NULL,
    ai_status NVARCHAR(20) NOT NULL CONSTRAINT DF_study_entry_ai_analyses_ai_status DEFAULT (N'none'),
    ai_result NVARCHAR(MAX) NULL,
    ai_analyzed_at DATETIME2(0) NULL,
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_study_entry_ai_analyses_updated_at DEFAULT SYSUTCDATETIME()
  );

  CREATE UNIQUE INDEX UX_study_entry_ai_analyses_entry ON dbo.study_entry_ai_analyses(user_id, child_id, book_id, study_date);
END;
GO
CREATE OR ALTER PROCEDURE dbo.app_add_study_entry_attachment
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE,
  @original_name NVARCHAR(255),
  @stored_name NVARCHAR(255),
  @file_path NVARCHAR(1000),
  @mime_type NVARCHAR(100),
  @file_size BIGINT
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @id UNIQUEIDENTIFIER = NEWID();

  IF NOT EXISTS (
    SELECT 1
    FROM dbo.study_entries
    WHERE user_id = @user_id
      AND child_id = @child_id
      AND book_id = @book_id
      AND study_date = @study_date
  )
  BEGIN
    RAISERROR('Study entry was not found for attachment.', 16, 1);
    RETURN;
  END;

  INSERT INTO dbo.study_entry_attachments (
    id,
    user_id,
    child_id,
    book_id,
    study_date,
    original_name,
    stored_name,
    file_path,
    mime_type,
    file_size
  )
  VALUES (
    @id,
    @user_id,
    @child_id,
    @book_id,
    @study_date,
    @original_name,
    @stored_name,
    @file_path,
    @mime_type,
    @file_size
  );

  SELECT
    id,
    original_name AS originalName,
    file_path AS filePath,
    mime_type AS mimeType,
    file_size AS fileSize,
    ai_status AS aiStatus,
    ai_result AS aiResult,
    ai_analyzed_at AS aiAnalyzedAt,
    teacher_viewed_at AS teacherViewedAt,
    created_at AS createdAt
  FROM dbo.study_entry_attachments
  WHERE id = @id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_study_entry_attachments
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    a.id,
    a.original_name AS originalName,
    a.file_path AS filePath,
    a.mime_type AS mimeType,
    a.file_size AS fileSize,
    a.ai_status AS aiStatus,
    a.ai_result AS aiResult,
    a.ai_analyzed_at AS aiAnalyzedAt,
    ea.ai_status AS entryAiStatus,
    a.teacher_viewed_at AS teacherViewedAt,
    a.created_at AS createdAt
  FROM dbo.study_entry_attachments a
  LEFT JOIN dbo.study_entry_ai_analyses ea
    ON ea.user_id = a.user_id
   AND ea.child_id = a.child_id
   AND ea.book_id = a.book_id
   AND ea.study_date = a.study_date
  WHERE a.user_id = @user_id
    AND a.child_id = @child_id
    AND a.book_id = @book_id
    AND a.study_date = @study_date
  ORDER BY a.created_at, a.original_name;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_study_entry_attachment_file
  @id UNIQUEIDENTIFIER,
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    id,
    user_id AS userId,
    child_id AS childId,
    book_id AS bookId,
    study_date AS studyDate,
    original_name AS originalName,
    stored_name AS storedName,
    file_path AS filePath,
    mime_type AS mimeType,
    file_size AS fileSize
  FROM dbo.study_entry_attachments
  WHERE id = @id
    AND user_id = @user_id
    AND (@child_id IS NULL OR child_id = @child_id);
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_delete_study_entry_attachment
  @id UNIQUEIDENTIFIER,
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @deleted TABLE (
    id UNIQUEIDENTIFIER,
    filePath NVARCHAR(1000)
  );

  DELETE a
  OUTPUT deleted.id, deleted.file_path INTO @deleted(id, filePath)
  FROM dbo.study_entry_attachments a
  WHERE a.id = @id
    AND a.user_id = @user_id
    AND a.child_id = @child_id
    AND a.teacher_viewed_at IS NULL
    AND a.ai_status = N'none'
    AND NOT EXISTS (
      SELECT 1
      FROM dbo.study_entry_ai_analyses ea
      WHERE ea.user_id = a.user_id
        AND ea.child_id = a.child_id
        AND ea.book_id = a.book_id
        AND ea.study_date = a.study_date
        AND ea.ai_status <> N'none'
    );

  SELECT id, filePath FROM @deleted;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_mark_study_entry_attachments_viewed
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.study_entry_attachments
  SET teacher_viewed_at = COALESCE(teacher_viewed_at, SYSUTCDATETIME())
  WHERE user_id = @user_id
    AND child_id = @child_id
    AND book_id = @book_id
    AND study_date = @study_date;

  SELECT
    a.id,
    a.original_name AS originalName,
    a.file_path AS filePath,
    a.mime_type AS mimeType,
    a.file_size AS fileSize,
    a.ai_status AS aiStatus,
    a.ai_result AS aiResult,
    a.ai_analyzed_at AS aiAnalyzedAt,
    ea.ai_status AS entryAiStatus,
    a.teacher_viewed_at AS teacherViewedAt,
    a.created_at AS createdAt
  FROM dbo.study_entry_attachments a
  LEFT JOIN dbo.study_entry_ai_analyses ea
    ON ea.user_id = a.user_id
   AND ea.child_id = a.child_id
   AND ea.book_id = a.book_id
   AND ea.study_date = a.study_date
  WHERE a.user_id = @user_id
    AND a.child_id = @child_id
    AND a.book_id = @book_id
    AND a.study_date = @study_date
  ORDER BY a.created_at, a.original_name;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_study_entry_ai_analysis
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE
AS
BEGIN
  SET NOCOUNT ON;

  SELECT TOP 1
    ai_status AS aiStatus,
    ai_result AS aiResult,
    ai_analyzed_at AS aiAnalyzedAt,
    updated_at AS updatedAt
  FROM dbo.study_entry_ai_analyses
  WHERE user_id = @user_id
    AND child_id = @child_id
    AND book_id = @book_id
    AND study_date = @study_date;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_study_entry_ai_analysis
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE,
  @ai_status NVARCHAR(20),
  @ai_result NVARCHAR(MAX)
AS
BEGIN
  SET NOCOUNT ON;

  MERGE dbo.study_entry_ai_analyses AS target
  USING (
    SELECT @user_id AS user_id, @child_id AS child_id, @book_id AS book_id, @study_date AS study_date
  ) AS source
  ON target.user_id = source.user_id
    AND target.child_id = source.child_id
    AND target.book_id = source.book_id
    AND target.study_date = source.study_date
  WHEN MATCHED THEN
    UPDATE SET
      ai_status = @ai_status,
      ai_result = @ai_result,
      ai_analyzed_at = CASE
        WHEN @ai_status IN (N'completed', N'failed') THEN SYSUTCDATETIME()
        ELSE ai_analyzed_at
      END,
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (user_id, child_id, book_id, study_date, ai_status, ai_result, ai_analyzed_at, updated_at)
    VALUES (
      @user_id,
      @child_id,
      @book_id,
      @study_date,
      @ai_status,
      @ai_result,
      CASE WHEN @ai_status IN (N'completed', N'failed') THEN SYSUTCDATETIME() ELSE NULL END,
      SYSUTCDATETIME()
    );

END;
GO

CREATE OR ALTER PROCEDURE dbo.app_update_study_entry_attachment_ai_result
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER,
  @book_id UNIQUEIDENTIFIER,
  @study_date DATE,
  @ai_status NVARCHAR(20),
  @ai_result NVARCHAR(MAX),
  @attachment_id UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.study_entry_attachments
  SET ai_status = @ai_status,
      ai_result = @ai_result,
      ai_analyzed_at = CASE
        WHEN @ai_status IN (N'completed', N'failed') THEN SYSUTCDATETIME()
        ELSE ai_analyzed_at
      END
  WHERE user_id = @user_id
    AND child_id = @child_id
    AND book_id = @book_id
    AND study_date = @study_date
    AND (@attachment_id IS NULL OR id = @attachment_id);

  SELECT
    id,
    original_name AS originalName,
    file_path AS filePath,
    mime_type AS mimeType,
    file_size AS fileSize,
    ai_status AS aiStatus,
    ai_result AS aiResult,
    ai_analyzed_at AS aiAnalyzedAt,
    teacher_viewed_at AS teacherViewedAt,
    created_at AS createdAt
  FROM dbo.study_entry_attachments
  WHERE user_id = @user_id
    AND child_id = @child_id
    AND book_id = @book_id
    AND study_date = @study_date
  ORDER BY created_at, original_name;
END;
GO
