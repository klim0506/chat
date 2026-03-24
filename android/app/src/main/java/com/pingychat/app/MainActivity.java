package com.pingychat.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://web.pingychat.com";
    private static final int REQUEST_RUNTIME_PERMISSIONS = 1001;
    private static final int REQUEST_FILE_CHOOSER = 1002;
    private static final String PREFS = "pingy_mobile_prefs";
    private static final String PREF_STARTUP_PERMISSIONS_REQUESTED = "startup_permissions_requested";
    private static final String PREF_NOTIFICATION_PERMISSION_REQUESTED = "notification_permission_requested";
    private static final String EXTRA_TARGET_PATH = "target_path";
    private static final String CHANNEL_MESSAGES = "pingy_messages";
    private static final String CHANNEL_GROUP_MESSAGES = "pingy_messages_group";
    private static final String NOTIFICATION_GROUP_KEY = "pingy_messages";
    private static final int SUMMARY_NOTIFICATION_ID = 9001;

    private WebView webView;
    private PermissionRequest pendingWebPermissionRequest;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean startupPermissionPromptShown = false;
    private final LinkedHashMap<String, String> summaryPreviewLines = new LinkedHashMap<>();

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        createNotificationChannel();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        webView.addJavascriptInterface(new PingyAndroidBridge(), "PingyAndroid");
        webView.setWebChromeClient(new PingyWebChromeClient());
        webView.setWebViewClient(
                new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        return handleUrl(view, request.getUrl());
                    }

                    @SuppressWarnings("deprecation")
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView view, String url) {
                        return handleUrl(view, Uri.parse(url));
                    }

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        super.onPageFinished(view, url);
                        maybeRequestStartupPermissions();
                    }
                });

        String targetPath = getTargetPathFromIntent(getIntent());
        webView.loadUrl(buildAppUrl(targetPath));
    }

    /**
     * Только веб-приложение на web.pingychat.com; маркетинговые домены pingychat.com перенаправляем в приложение.
     * Внешние URL (OAuth и т.д.) оставляем WebView.
     */
    private boolean handleUrl(@NonNull WebView view, @Nullable Uri uri) {
        if (uri == null) {
            return false;
        }
        String host = uri.getHost();
        if (host == null) {
            return false;
        }
        String h = host.toLowerCase();
        if ("web.pingychat.com".equals(h)) {
            return false;
        }
        if ("pingychat.com".equals(h) || "www.pingychat.com".equals(h)) {
            String targetPath = uri.getPath();
            view.loadUrl(buildAppUrl(targetPath));
            return true;
        }
        return false;
    }

    private String buildAppUrl(@Nullable String path) {
        if (TextUtils.isEmpty(path) || "/".equals(path)) {
            return APP_URL;
        }
        if (path.startsWith("http://") || path.startsWith("https://")) {
            return path;
        }
        return APP_URL + (path.startsWith("/") ? path : "/" + path);
    }

    private void maybeRequestStartupPermissions() {
        if (startupPermissionPromptShown) {
            return;
        }
        startupPermissionPromptShown = true;
        List<String> missing = getMissingStartupPermissions();
        if (missing.isEmpty()) {
            return;
        }
        getPrefs().edit().putBoolean(PREF_STARTUP_PERMISSIONS_REQUESTED, true).apply();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPrefs().edit().putBoolean(PREF_NOTIFICATION_PERMISSION_REQUESTED, true).apply();
        }
        new AlertDialog.Builder(this)
                .setTitle("Разрешения Pingy")
                .setMessage(
                        "Чтобы мобильное приложение работало как мессенджер, Pingy запросит:\n\n"
                                + "1. Показ уведомлений с предпросмотром сообщений.\n"
                                + "2. Камеру и микрофон для видео и голосовых.\n"
                                + "3. Доступ к файлам и фото для отправки вложений."
                )
                .setCancelable(false)
                .setNegativeButton("Позже", null)
                .setPositiveButton("Продолжить", (dialog, which) ->
                        ActivityCompat.requestPermissions(
                                MainActivity.this,
                                missing.toArray(new String[0]),
                                REQUEST_RUNTIME_PERMISSIONS
                        ))
                .show();
    }

    private List<String> getMissingStartupPermissions() {
        ArrayList<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!hasPermission(Manifest.permission.CAMERA)) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (!hasPermission(Manifest.permission.READ_MEDIA_IMAGES)) {
                missing.add(Manifest.permission.READ_MEDIA_IMAGES);
            }
            if (!hasPermission(Manifest.permission.READ_MEDIA_VIDEO)) {
                missing.add(Manifest.permission.READ_MEDIA_VIDEO);
            }
            if (!hasPermission(Manifest.permission.READ_MEDIA_AUDIO)) {
                missing.add(Manifest.permission.READ_MEDIA_AUDIO);
            }
        } else if (!hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE)) {
            missing.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        return missing;
    }

    private boolean hasPermission(@NonNull String permission) {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private String getNotificationPermissionState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }
        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            return "granted";
        }
        if (getPrefs().getBoolean(PREF_NOTIFICATION_PERMISSION_REQUESTED, false)) {
            return "denied";
        }
        return "default";
    }

    private void requestNotificationPermissionOnly() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            return;
        }
        getPrefs().edit().putBoolean(PREF_NOTIFICATION_PERMISSION_REQUESTED, true).apply();
        ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_RUNTIME_PERMISSIONS
        );
    }

    private String[] getRequiredPermissionsForWebResources(@Nullable String[] resources) {
        ArrayList<String> permissions = new ArrayList<>();
        if (resources == null) {
            return new String[0];
        }
        for (String resource : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && !permissions.contains(Manifest.permission.RECORD_AUDIO)) {
                permissions.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                if (!permissions.contains(Manifest.permission.CAMERA)) {
                    permissions.add(Manifest.permission.CAMERA);
                }
                if (!permissions.contains(Manifest.permission.RECORD_AUDIO)) {
                    permissions.add(Manifest.permission.RECORD_AUDIO);
                }
            }
        }
        return permissions.toArray(new String[0]);
    }

    private boolean hasAllPermissions(@NonNull String[] permissions) {
        for (String permission : permissions) {
            if (!hasPermission(permission)) {
                return false;
            }
        }
        return true;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannelGroup group = new NotificationChannelGroup(CHANNEL_GROUP_MESSAGES, "Pingy messages");
        manager.createNotificationChannelGroup(group);

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_MESSAGES,
                "Сообщения Pingy",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Личные и групповые сообщения с предпросмотром");
        channel.setGroup(CHANNEL_GROUP_MESSAGES);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    private PendingIntent buildOpenConversationIntent(@Nullable String chatId) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra(EXTRA_TARGET_PATH, TextUtils.isEmpty(chatId) ? "/chats" : "/chat/" + chatId);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        int requestCode = TextUtils.isEmpty(chatId) ? SUMMARY_NOTIFICATION_ID : Math.abs(chatId.hashCode());
        return PendingIntent.getActivity(this, requestCode, intent, flags);
    }

    private void showNativeMessageNotification(
            @Nullable String chatTitle,
            @Nullable String sender,
            @Nullable String body,
            @Nullable String chatId,
            long timestamp
    ) {
        String safeChatTitle = !TextUtils.isEmpty(chatTitle) ? chatTitle : getString(R.string.app_name);
        String safeSender = !TextUtils.isEmpty(sender) ? sender : safeChatTitle;
        String safeBody = body == null ? "" : body;
        long when = timestamp > 0 ? timestamp : System.currentTimeMillis();
        String chatKey = !TextUtils.isEmpty(chatId) ? chatId : "general";

        Person author = new Person.Builder().setName(safeSender).build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(author)
                .setConversationTitle(safeChatTitle)
                .addMessage(safeBody, when, author);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(safeSender)
                .setContentText(safeBody)
                .setSubText(safeChatTitle)
                .setStyle(style)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(buildOpenConversationIntent(chatId))
                .setGroup(NOTIFICATION_GROUP_KEY)
                .setWhen(when)
                .setShowWhen(true);

        NotificationManagerCompat.from(this).notify(chatKey, Math.abs(chatKey.hashCode()), builder.build());
        updateNotificationSummary(chatKey, safeSender + ": " + safeBody);
    }

    private void updateNotificationSummary(@NonNull String chatKey, @NonNull String previewLine) {
        summaryPreviewLines.remove(chatKey);
        summaryPreviewLines.put(chatKey, previewLine);
        while (summaryPreviewLines.size() > 5) {
            Map.Entry<String, String> eldest = summaryPreviewLines.entrySet().iterator().next();
            summaryPreviewLines.remove(eldest.getKey());
        }

        NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle()
                .setBigContentTitle("Pingy")
                .setSummaryText(summaryPreviewLines.size() + " чатов");
        for (String line : summaryPreviewLines.values()) {
            inbox.addLine(line);
        }

        NotificationCompat.Builder summary = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Pingy")
                .setContentText("Новые сообщения")
                .setStyle(inbox)
                .setGroup(NOTIFICATION_GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(buildOpenConversationIntent(null));

        NotificationManagerCompat.from(this).notify(SUMMARY_NOTIFICATION_ID, summary.build());
    }

    @Nullable
    private String getTargetPathFromIntent(@Nullable Intent intent) {
        if (intent == null) {
            return null;
        }
        String targetPath = intent.getStringExtra(EXTRA_TARGET_PATH);
        if (TextUtils.isEmpty(targetPath)) {
            return null;
        }
        return targetPath;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String targetPath = getTargetPathFromIntent(intent);
        if (webView != null && targetPath != null) {
            webView.loadUrl(buildAppUrl(targetPath));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // Never inject inline JS: CSP may block evaluateJavascript in strict script-src policies.
        String currentUrl = webView.getUrl();
        if (!TextUtils.isEmpty(currentUrl)) {
            Uri current = Uri.parse(currentUrl);
            String path = current.getPath();
            if (!TextUtils.isEmpty(path)
                    && !path.startsWith("/chat/join")
                    && (path.startsWith("/chat/") || path.startsWith("/channel/"))) {
                webView.loadUrl(buildAppUrl("/chats"));
                return;
            }
        }
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            MainActivity.super.onBackPressed();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_RUNTIME_PERMISSIONS) {
            return;
        }
        if (pendingWebPermissionRequest != null) {
            String[] needed = getRequiredPermissionsForWebResources(pendingWebPermissionRequest.getResources());
            if (hasAllPermissions(needed)) {
                pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
            } else {
                pendingWebPermissionRequest.deny();
            }
            pendingWebPermissionRequest = null;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            Uri[] results = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else {
                    results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class PingyWebChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> {
                String[] needed = getRequiredPermissionsForWebResources(request.getResources());
                if (needed.length == 0 || hasAllPermissions(needed)) {
                    request.grant(request.getResources());
                    return;
                }
                pendingWebPermissionRequest = request;
                ActivityCompat.requestPermissions(
                        MainActivity.this,
                        needed,
                        REQUEST_RUNTIME_PERMISSIONS
                );
            });
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            if (MainActivity.this.filePathCallback != null) {
                MainActivity.this.filePathCallback.onReceiveValue(null);
            }
            MainActivity.this.filePathCallback = filePathCallback;
            Intent intent;
            try {
                intent = fileChooserParams != null ? fileChooserParams.createIntent() : null;
            } catch (Exception e) {
                intent = null;
            }
            if (intent == null) {
                intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(intent, "Выберите файл"), REQUEST_FILE_CHOOSER);
                return true;
            } catch (Exception e) {
                MainActivity.this.filePathCallback = null;
                return false;
            }
        }
    }

    private final class PingyAndroidBridge {
        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }

        @JavascriptInterface
        public String getNotificationPermission() {
            return getNotificationPermissionState();
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(MainActivity.this::requestNotificationPermissionOnly);
        }

        @JavascriptInterface
        public void showMessageNotification(
                String chatTitle,
                String sender,
                String body,
                String chatId,
                String timestampMs
        ) {
            long timestamp = 0L;
            try {
                timestamp = Long.parseLong(timestampMs);
            } catch (Exception ignored) {
                /* ignore */
            }
            final long finalTimestamp = timestamp;
            runOnUiThread(() -> showNativeMessageNotification(chatTitle, sender, body, chatId, finalTimestamp));
        }
    }
}
