plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
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
        versionCode = 5
        versionName = "0.5.0"
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
}
