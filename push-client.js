(function setupStudyFlowPush() {
  const api = {
    isSupported,
    getSubscriptionState,
    subscribe,
    unsubscribe,
    isNativeApp: isNativePlatform,
    registerNativeAppToken,
    unregisterNativeAppToken
  };

  window.StudyFlowPush = api;
  const NATIVE_APP_TOKEN_KEY = "studyflow-native-push-token";
  const NATIVE_DEVICE_ID_KEY = "studyflow-native-device-id";

  function isSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  async function getRegistration() {
    if (!isSupported()) throw new Error("이 브라우저는 푸시 알림을 지원하지 않습니다.");
    const existing = await navigator.serviceWorker.getRegistration("./");
    return existing || navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  }

  async function requestJson(path, token, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "푸시 요청을 처리하지 못했습니다.");
    return data;
  }

  async function getSubscriptionState(token = "") {
    if (!isSupported()) return { supported: false, subscribed: false, permission: "unsupported" };
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    let registered = Boolean(subscription);

    if (subscription && token) {
      const status = await requestJson("/api/push/subscription/status", token, {
        method: "POST",
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      registered = Boolean(status.registered);
    }

    return {
      supported: true,
      subscribed: registered,
      permission: Notification.permission
    };
  }

  async function subscribe(token) {
    if (!token) throw new Error("로그인이 필요합니다.");
    const keyData = await fetch("/api/push/public-key").then((response) => response.json());
    if (!keyData.publicKey) throw new Error("서버 푸시 키가 설정되지 않았습니다.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("알림 권한이 허용되지 않았습니다.");

    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription() ||
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });

    await requestJson("/api/push/subscription", token, {
      method: "PUT",
      body: JSON.stringify({ subscription })
    });

    return getSubscriptionState(token);
  }

  async function unsubscribe(token) {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return getSubscriptionState();

    const result = await requestJson("/api/push/subscription", token, {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    if (!result.activeSubscriptionCount) {
      await subscription.unsubscribe();
    }
    return getSubscriptionState(token);
  }

  async function registerNativeAppToken(authToken) {
    const pushPlugin = window.Capacitor?.Plugins?.PushNotifications;
    if (!authToken || !pushPlugin || !isNativePlatform()) return { registered: false };

    const permission = await pushPlugin.requestPermissions();
    if (permission.receive !== "granted") return { registered: false, permission: permission.receive };

    const registration = new Promise((resolve, reject) => {
      pushPlugin.addListener("registration", (token) => resolve(token.value));
      pushPlugin.addListener("registrationError", (error) => reject(error));
    });

    await pushPlugin.register();
    const nativeToken = await registration;
    const platform = window.Capacitor.getPlatform?.() || "android";
    const deviceId = getNativeDeviceId();

    await requestJson("/api/push/app-token", authToken, {
      method: "PUT",
      body: JSON.stringify({
        token: nativeToken,
        platform,
        deviceId
      })
    });

    localStorage.setItem(NATIVE_APP_TOKEN_KEY, nativeToken);
    return { registered: true, platform };
  }

  async function unregisterNativeAppToken(authToken) {
    const nativeToken = localStorage.getItem(NATIVE_APP_TOKEN_KEY);
    if (!authToken || !nativeToken) return { ok: true };

    await requestJson("/api/push/app-token", authToken, {
      method: "DELETE",
      body: JSON.stringify({ token: nativeToken })
    });
    localStorage.removeItem(NATIVE_APP_TOKEN_KEY);
    return { ok: true };
  }

  function isNativePlatform() {
    if (typeof window.Capacitor?.isNativePlatform === "function") {
      return window.Capacitor.isNativePlatform();
    }
    return ["android", "ios"].includes(window.Capacitor?.getPlatform?.());
  }

  function getNativeDeviceId() {
    let id = localStorage.getItem(NATIVE_DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      localStorage.setItem(NATIVE_DEVICE_ID_KEY, id);
    }
    return id;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let index = 0; index < rawData.length; index += 1) {
      outputArray[index] = rawData.charCodeAt(index);
    }
    return outputArray;
  }
})();
