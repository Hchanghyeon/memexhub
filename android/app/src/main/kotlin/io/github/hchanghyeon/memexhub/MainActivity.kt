package io.github.hchanghyeon.memexhub

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.hchanghyeon.memexhub.ui.App
import io.github.hchanghyeon.memexhub.ui.MemexhubTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { MemexhubTheme { App() } }
    }
}
