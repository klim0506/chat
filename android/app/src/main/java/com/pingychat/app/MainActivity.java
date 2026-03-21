package com.pingychat.app;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://web.pingychat.com";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

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
                });

        webView.loadUrl(APP_URL);
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
            view.loadUrl(APP_URL);
            return true;
        }
        return false;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
