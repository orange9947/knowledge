package com.orange.ailkg;

import android.os.Bundle;
import android.graphics.Color;
import android.view.Window;
import android.util.Log;

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
            } catch (Exception error) {
                Log.e(TAG, "Failed to start local backend", error);
            }
        }, "ailkg-backend-start");
        backendThread.setDaemon(true);
        backendThread.start();
    }
}
