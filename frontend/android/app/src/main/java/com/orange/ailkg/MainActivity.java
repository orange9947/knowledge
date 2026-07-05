package com.orange.ailkg;

import android.os.Bundle;
import android.graphics.Color;
import android.view.Window;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int BACKEND_PORT = 43126;
    private static final String TAG = "AILKG";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(244, 247, 245));
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(true);
        }
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }
        startBackend();
        super.onCreate(savedInstanceState);
    }

    private void startBackend() {
        final String dataDir = getFilesDir().getAbsolutePath();
        Thread backendThread = new Thread(() -> {
            try {
                Python.getInstance()
                    .getModule("android_server")
                    .callAttr("start", dataDir, BACKEND_PORT);
                Log.i(TAG, "Local backend start requested on 127.0.0.1:" + BACKEND_PORT);
                waitForBackendHealth();
            } catch (Exception error) {
                Log.e(TAG, "Failed to start local backend", error);
            }
        }, "ailkg-backend-start");
        backendThread.setDaemon(true);
        backendThread.start();
    }

    private void waitForBackendHealth() {
        for (int attempt = 1; attempt <= 20; attempt += 1) {
            try {
                String body = getHealth();
                Log.i(TAG, "Local backend health OK: " + body);
                return;
            } catch (Exception error) {
                Log.i(TAG, "Waiting for local backend health, attempt " + attempt + ": " + error.getMessage());
                try {
                    Thread.sleep(500);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        Log.e(TAG, "Local backend health did not become ready on 127.0.0.1:" + BACKEND_PORT);
    }

    private String getHealth() throws Exception {
        URL url = new URL("http://127.0.0.1:" + BACKEND_PORT + "/health");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(500);
        connection.setReadTimeout(500);
        connection.setRequestMethod("GET");
        int responseCode = connection.getResponseCode();
        if (responseCode < 200 || responseCode >= 300) {
            throw new IllegalStateException("HTTP " + responseCode);
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
            return reader.readLine();
        } finally {
            connection.disconnect();
        }
    }
}
