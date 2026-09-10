package com.chatapp.horizon.network

import com.chatapp.horizon.models.*
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

interface ApiService {

    @POST("api/auth/register")
    suspend fun register(@Body request: AuthRequest): Response<AuthResponse>

    @POST("api/auth/login")
    suspend fun login(@Body request: AuthRequest): Response<AuthResponse>

    @GET("api/users/lookup")
    suspend fun lookupUser(
        @Header("Authorization") token: String,
        @Query("username") username: String
    ): Response<User>

    @GET("api/messages/{targetUserId}")
    suspend fun getMessages(
        @Header("Authorization") token: String,
        @Path("targetUserId") targetUserId: Int,
        @Query("cursor") cursor: Long? = null,
        @Query("limit") limit: Int = 25
    ): Response<List<ChatMessage>>

    @GET("api/chats")
    suspend fun getChats(
        @Header("Authorization") token: String
    ): Response<List<Conversation>>

    @POST("api/media/presign")
    suspend fun presignMediaUpload(
        @Header("Authorization") token: String,
        @Body request: PresignRequest
    ): Response<PresignResponse>

    @GET("api/users/me")
    suspend fun getProfile(
        @Header("Authorization") token: String
    ): Response<User>

    @PUT("api/users/profile")
    suspend fun updateProfile(
        @Header("Authorization") token: String,
        @Body request: UpdateProfileRequest
    ): Response<ProfileResponse>

    @PUT("api/users/password")
    suspend fun updatePassword(
        @Header("Authorization") token: String,
        @Body request: UpdatePasswordRequest
    ): Response<GenericResponse>

    @POST("api/messages/{id}/view-once")
    suspend fun markViewOnceOpened(
        @Header("Authorization") token: String,
        @Path("id") messageId: Long
    ): Response<GenericResponse>

    @POST("api/media/upload")
    suspend fun uploadMedia(
        @Header("Authorization") token: String,
        @Body request: MediaUploadRequest
    ): Response<MediaUploadResponse>
}

object ApiClient {
    // Default URL: Live Render cloud deployment
    var BASE_URL = "https://horizon-chat-1.onrender.com/"

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = HttpLoggingInterceptor.Level.BODY
    }

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(60, TimeUnit.SECONDS) // 60s cold start timeout (Rules Section 1)
        .readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor(loggingInterceptor)
        .build()

    val apiService: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }
}
