package com.orange.ailkg;

import android.os.Bundle;
import android.graphics.Color;
import android.view.Window;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int BACKEND_PORT = 43126;

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
        Python.getInstance()
            .getModule("android_server")
            .callAttr("start", getFilesDir().getAbsolutePath(), BACKEND_PORT);
        super.onCreate(savedInstanceState);
    }
}
