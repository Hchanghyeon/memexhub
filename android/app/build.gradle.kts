plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

android {
    namespace = "io.github.hchanghyeon.memexhub"
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "io.github.hchanghyeon.memexhub"
        // Android 9: Health Connect needs it, and it still covers almost every phone in use.
        minSdk = 28
        targetSdk = 37
        versionCode = 8
        versionName = "0.8.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    buildFeatures {
        compose = true
    }
    // Screenshots of every screen on the JVM (Robolectric), cover and unfolded: see ScreenshotTest.
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { it.maxHeapSize = "1536m" }
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.work.runtime)
    implementation(libs.commonmark)
    implementation(libs.commonmark.tables)
    implementation(libs.commonmark.strikethrough)
    implementation(libs.commonmark.tasks)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.androidx.test.junit)
    debugImplementation(libs.compose.ui.test.manifest)
}
