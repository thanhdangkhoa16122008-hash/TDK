plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tdk.may"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tdk.may"
        minSdk = 29          // Android 10+
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters += listOf("arm64-v8a") }   // điện thoại hiện đại; giảm dung lượng APK
    }
    signingConfigs {
        // Khóa ký cố định trong repo (không phải bí mật) để cài bản mới đè lên bản cũ không bị lỗi chữ ký.
        getByName("debug") {
            storeFile = file("may-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("debug") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("com.google.mediapipe:tasks-genai:0.10.24")   // chạy LLM ngay trên điện thoại (GPU/CPU)
    implementation("com.google.guava:guava:33.3.1-android")
}
