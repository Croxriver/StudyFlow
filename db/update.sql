IF OBJECT_ID('dbo.user_settings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.user_settings (
    user_id UNIQUEIDENTIFIER NOT NULL,
    setting_key NVARCHAR(100) NOT NULL,
    setting_value NVARCHAR(1000) NULL,
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_settings_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_user_settings_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_user_settings PRIMARY KEY (user_id, setting_key),
    CONSTRAINT FK_user_settings_users FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
  );
END;
GO

IF OBJECT_ID('dbo.push_subscriptions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.push_subscriptions (
    id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_push_subscriptions_id DEFAULT NEWID() PRIMARY KEY,
    user_id UNIQUEIDENTIFIER NOT NULL,
    child_id UNIQUEIDENTIFIER NULL,
    role NVARCHAR(20) NOT NULL,
    channel NVARCHAR(20) NOT NULL CONSTRAINT DF_push_subscriptions_channel DEFAULT (N'web'),
    platform NVARCHAR(20) NOT NULL CONSTRAINT DF_push_subscriptions_platform DEFAULT (N'web'),
    device_id NVARCHAR(255) NULL,
    endpoint NVARCHAR(1000) NOT NULL,
    endpoint_hash VARBINARY(32) NOT NULL,
    token NVARCHAR(1000) NULL,
    token_hash VARBINARY(32) NULL,
    p256dh NVARCHAR(255) NOT NULL,
    auth NVARCHAR(255) NOT NULL,
    user_agent NVARCHAR(500) NULL,
    enabled BIT NOT NULL CONSTRAINT DF_push_subscriptions_enabled DEFAULT (1),
    created_at DATETIME2(0) NOT NULL CONSTRAINT DF_push_subscriptions_created_at DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2(0) NOT NULL CONSTRAINT DF_push_subscriptions_last_seen_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2(0) NOT NULL CONSTRAINT DF_push_subscriptions_updated_at DEFAULT SYSUTCDATETIME()
  );

  CREATE UNIQUE INDEX UX_push_subscriptions_owner_endpoint ON dbo.push_subscriptions(endpoint_hash, user_id, role, child_id) WHERE channel = N'web' AND endpoint_hash IS NOT NULL;
  CREATE UNIQUE INDEX UX_push_subscriptions_owner_token ON dbo.push_subscriptions(token_hash, user_id, role, child_id) WHERE channel = N'app' AND token_hash IS NOT NULL;
  CREATE INDEX IX_push_subscriptions_user_target ON dbo.push_subscriptions(user_id, role, child_id, channel, enabled);
END;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_push_subscriptions_endpoint_hash' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
  DROP INDEX UX_push_subscriptions_endpoint_hash ON dbo.push_subscriptions;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_push_subscriptions_owner_endpoint' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
  DROP INDEX UX_push_subscriptions_owner_endpoint ON dbo.push_subscriptions;
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_push_subscriptions_owner_token' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
  DROP INDEX UX_push_subscriptions_owner_token ON dbo.push_subscriptions;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'channel') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD channel NVARCHAR(20) NOT NULL CONSTRAINT DF_push_subscriptions_channel DEFAULT (N'web') WITH VALUES;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'platform') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD platform NVARCHAR(20) NOT NULL CONSTRAINT DF_push_subscriptions_platform DEFAULT (N'web') WITH VALUES;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'device_id') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD device_id NVARCHAR(255) NULL;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'token') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD token NVARCHAR(1000) NULL;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'token_hash') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD token_hash VARBINARY(32) NULL;
GO

IF COL_LENGTH('dbo.push_subscriptions', 'last_seen_at') IS NULL
  ALTER TABLE dbo.push_subscriptions ADD last_seen_at DATETIME2(0) NOT NULL CONSTRAINT DF_push_subscriptions_last_seen_at DEFAULT SYSUTCDATETIME() WITH VALUES;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_push_subscriptions_owner_endpoint' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
  CREATE UNIQUE INDEX UX_push_subscriptions_owner_endpoint ON dbo.push_subscriptions(endpoint_hash, user_id, role, child_id) WHERE channel = N'web' AND endpoint_hash IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_push_subscriptions_owner_token' AND object_id = OBJECT_ID(N'dbo.push_subscriptions'))
  CREATE UNIQUE INDEX UX_push_subscriptions_owner_token ON dbo.push_subscriptions(token_hash, user_id, role, child_id) WHERE channel = N'app' AND token_hash IS NOT NULL;
GO

CREATE OR ALTER PROCEDURE dbo.app_save_push_subscription
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @endpoint NVARCHAR(1000),
  @p256dh NVARCHAR(255),
  @auth NVARCHAR(255),
  @user_agent NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @endpoint_hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @endpoint));

  MERGE dbo.push_subscriptions AS target
  USING (
    SELECT
      @endpoint_hash AS endpoint_hash,
      @user_id AS user_id,
      @role AS role,
      @child_id AS child_id
  ) AS source
  ON
    target.endpoint_hash = source.endpoint_hash
    AND target.user_id = source.user_id
    AND target.role = source.role
    AND (
      target.child_id = source.child_id
      OR (target.child_id IS NULL AND source.child_id IS NULL)
    )
  WHEN MATCHED THEN
    UPDATE SET
      channel = N'web',
      platform = N'web',
      device_id = NULL,
      endpoint = @endpoint,
      p256dh = @p256dh,
      auth = @auth,
      token = NULL,
      token_hash = NULL,
      user_agent = @user_agent,
      enabled = 1,
      last_seen_at = SYSUTCDATETIME(),
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (user_id, child_id, role, channel, platform, endpoint, endpoint_hash, p256dh, auth, user_agent)
    VALUES (@user_id, @child_id, @role, N'web', N'web', @endpoint, @endpoint_hash, @p256dh, @auth, @user_agent);

  SELECT CAST(1 AS BIT) AS ok;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_save_push_app_token
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @platform NVARCHAR(20),
  @device_id NVARCHAR(255) = NULL,
  @token NVARCHAR(1000),
  @user_agent NVARCHAR(500) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @token_hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @token));

  MERGE dbo.push_subscriptions AS target
  USING (
    SELECT
      @token_hash AS token_hash,
      @user_id AS user_id,
      @role AS role,
      @child_id AS child_id
  ) AS source
  ON
    target.token_hash = source.token_hash
    AND target.user_id = source.user_id
    AND target.role = source.role
    AND (
      target.child_id = source.child_id
      OR (target.child_id IS NULL AND source.child_id IS NULL)
    )
  WHEN MATCHED THEN
    UPDATE SET
      channel = N'app',
      platform = @platform,
      device_id = NULLIF(@device_id, ''),
      token = @token,
      endpoint = N'app:' + CONVERT(NVARCHAR(64), @token_hash, 2),
      endpoint_hash = @token_hash,
      p256dh = N'',
      auth = N'',
      user_agent = @user_agent,
      enabled = 1,
      last_seen_at = SYSUTCDATETIME(),
      updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN
    INSERT (user_id, child_id, role, channel, platform, device_id, endpoint, endpoint_hash, token, token_hash, p256dh, auth, user_agent)
    VALUES (@user_id, @child_id, @role, N'app', @platform, NULLIF(@device_id, ''), N'app:' + CONVERT(NVARCHAR(64), @token_hash, 2), @token_hash, @token, @token_hash, N'', N'', @user_agent);

  SELECT CAST(1 AS BIT) AS ok;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_disable_push_subscription
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @endpoint NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @endpoint_hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @endpoint));

  UPDATE dbo.push_subscriptions
  SET enabled = 0, updated_at = SYSUTCDATETIME()
  WHERE
    channel = N'web'
    AND endpoint_hash = @endpoint_hash
    AND user_id = @user_id
    AND role = @role
    AND (
      child_id = @child_id
      OR (child_id IS NULL AND @child_id IS NULL)
    );

  SELECT COUNT(1) AS activeSubscriptionCount
  FROM dbo.push_subscriptions
  WHERE endpoint_hash = @endpoint_hash AND enabled = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_disable_push_app_token
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @token NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @token_hash VARBINARY(32) = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @token));

  UPDATE dbo.push_subscriptions
  SET enabled = 0, updated_at = SYSUTCDATETIME()
  WHERE
    channel = N'app'
    AND token_hash = @token_hash
    AND user_id = @user_id
    AND role = @role
    AND (
      child_id = @child_id
      OR (child_id IS NULL AND @child_id IS NULL)
    );

  SELECT CAST(1 AS BIT) AS ok;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_disable_push_endpoint
  @endpoint NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;

  UPDATE dbo.push_subscriptions
  SET enabled = 0, updated_at = SYSUTCDATETIME()
  WHERE endpoint_hash = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @endpoint));

  SELECT CAST(1 AS BIT) AS ok;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_push_subscription_status
  @user_id UNIQUEIDENTIFIER,
  @child_id UNIQUEIDENTIFIER = NULL,
  @role NVARCHAR(20),
  @endpoint NVARCHAR(1000)
AS
BEGIN
  SET NOCOUNT ON;

  SELECT CAST(CASE WHEN EXISTS (
    SELECT 1
    FROM dbo.push_subscriptions
    WHERE
      channel = N'web'
      AND endpoint_hash = HASHBYTES('SHA2_256', CONVERT(NVARCHAR(1000), @endpoint))
      AND user_id = @user_id
      AND role = @role
      AND enabled = 1
      AND (
        child_id = @child_id
        OR (child_id IS NULL AND @child_id IS NULL)
      )
  ) THEN 1 ELSE 0 END AS BIT) AS registered;
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_push_subscriptions
  @user_id UNIQUEIDENTIFIER,
  @target NVARCHAR(30) = N'all_students',
  @child_id UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT endpoint, p256dh, auth
  FROM dbo.push_subscriptions
  WHERE
    user_id = @user_id
    AND channel = N'web'
    AND enabled = 1
    AND (
      @target = N'all'
      OR (@target = N'teachers' AND role = N'teacher')
      OR (@target = N'all_students' AND role = N'student')
      OR (@target = N'child' AND role = N'student' AND child_id = @child_id)
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.app_get_push_targets
  @user_id UNIQUEIDENTIFIER,
  @target NVARCHAR(30) = N'all_students',
  @child_id UNIQUEIDENTIFIER = NULL
AS
BEGIN
  SET NOCOUNT ON;

  SELECT
    channel,
    platform,
    endpoint,
    p256dh,
    auth,
    token,
    device_id AS deviceId,
    last_seen_at AS lastSeenAt
  FROM dbo.push_subscriptions
  WHERE
    user_id = @user_id
    AND enabled = 1
    AND (
      @target = N'all'
      OR (@target = N'teachers' AND role = N'teacher')
      OR (@target = N'all_students' AND role = N'student')
      OR (@target = N'child' AND role = N'student' AND child_id = @child_id)
    )
  ORDER BY CASE WHEN channel = N'app' THEN 0 ELSE 1 END, last_seen_at DESC;
END;
GO
