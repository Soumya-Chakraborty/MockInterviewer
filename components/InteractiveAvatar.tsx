import type { StartAvatarResponse } from "@heygen/streaming-avatar";

import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskMode,
  TaskType,
  VoiceEmotion,
} from "@heygen/streaming-avatar";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Input,
  Select,
  SelectItem,
  Spinner,
  Chip,
  Switch,
  Tooltip,
} from "@nextui-org/react";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn } from "ahooks";
import { Microphone, MicrophoneSlash } from "@phosphor-icons/react";

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";
import { SpeechToText } from "@/app/lib/speechToText";

import { AVATARS, STT_LANGUAGE_LIST } from "@/app/lib/constants";

export default function InteractiveAvatar() {
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [knowledgeId, setKnowledgeId] = useState<string>("");
  const [avatarId, setAvatarId] = useState<string>("");
  const [language, setLanguage] = useState<string>("en");
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<{ role: string; content: string }[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const speechToText = useRef<SpeechToText | null>(null);

  // Initialize speech-to-text
  useEffect(() => {
    if (typeof window !== 'undefined') {
      speechToText.current = new SpeechToText();
      setSpeechSupported(speechToText.current.isSupported());
      
      if (speechToText.current) {
        speechToText.current.onResult((transcript) => {
          setText(transcript);
          setIsListening(false);
        });
        
        speechToText.current.onError((error) => {
          setDebug(error);
          setIsListening(false);
        });
        
        speechToText.current.onEnd(() => {
          setIsListening(false);
        });
      }
    }
    
    return () => {
      if (speechToText.current && speechToText.current.isActive()) {
        speechToText.current.stopListening();
      }
    };
  }, []);

  function baseApiUrl() {
    return process.env.NEXT_PUBLIC_BASE_API_URL;
  }

  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      const token = await response.text();
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
    }
    return "";
  }

  async function startSession() {
    setIsLoadingSession(true);
    const newToken = await fetchAccessToken();

    avatar.current = new StreamingAvatar({
      token: newToken,
      basePath: baseApiUrl(),
    });
    avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
      console.log("Avatar started talking", e);
    });
    avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
      console.log("Avatar stopped talking", e);
    });
    avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
      console.log("Stream disconnected");
      endSession();
    });
    avatar.current?.on(StreamingEvents.STREAM_READY, (event) => {
      console.log(">>>>> Stream ready:", event.detail);
      setStream(event.detail);
    });

    try {
      const res = await avatar.current.createStartAvatar({
        quality: AvatarQuality.Low,
        avatarName: avatarId,
        knowledgeId: knowledgeId,
        voice: {
          rate: 1.5,
          emotion: VoiceEmotion.EXCITED,
        },
        language: language,
        disableIdleTimeout: true,
      });

      setData(res);
    } catch (error) {
      console.error("Error starting avatar session:", error);
    } finally {
      setIsLoadingSession(false);
    }
  }

  async function getGeminiResponse(prompt: string): Promise<string> {
    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error("Error getting Gemini response:", error);
      return "Sorry, I couldn't generate a response at the moment.";
    }
  }

  async function handleSpeak() {
    setIsLoadingRepeat(true);
    if (!avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }

    try {
      // Get response from Gemini
      const geminiResponse = await getGeminiResponse(text);
      
      // Update conversation history
      setConversationHistory(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: geminiResponse }
      ]);

      // Make avatar speak the response
      await avatar.current
        .speak({ text: geminiResponse, taskType: TaskType.REPEAT, taskMode: TaskMode.SYNC })
        .catch((e) => {
          setDebug(e.message);
        });

      // If in auto mode, automatically send the next message after a delay
      if (isAutoMode) {
        setTimeout(() => {
          setText(geminiResponse);
          handleSpeak();
        }, 2000); // 2 second delay between messages
      }
    } catch (error) {
      console.error("Error in handleSpeak:", error);
      setDebug("Error processing response");
    } finally {
      setIsLoadingRepeat(false);
    }
  }

  async function handleInterrupt() {
    if (!avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
    await avatar.current.interrupt().catch((e) => {
      setDebug(e.message);
    });
  }

  async function endSession() {
    await avatar.current?.stopAvatar();
    setStream(undefined);
  }

  useEffect(() => {
    return () => {
      endSession();
    };
  }, []);

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
        setDebug("Playing");
      };
    }
  }, [mediaStream, stream]);

  const toggleListening = () => {
    if (!speechToText.current) return;
    
    if (isListening) {
      speechToText.current.stopListening();
      setIsListening(false);
    } else {
      const started = speechToText.current.startListening();
      if (started) {
        setIsListening(true);
        setDebug("Listening...");
      }
    }
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <Card>
        <CardBody className="h-[500px] flex flex-col justify-center items-center">
          {stream ? (
            <div className="h-[500px] w-[900px] justify-center items-center flex rounded-lg overflow-hidden">
              <video
                ref={mediaStream}
                autoPlay
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              >
                <track kind="captions" />
              </video>
              <div className="flex flex-col gap-2 absolute bottom-3 right-3">
                <Button
                  className="bg-gradient-to-tr from-indigo-500 to-indigo-300 text-white rounded-lg"
                  size="md"
                  variant="shadow"
                  onClick={handleInterrupt}
                >
                  Interrupt task
                </Button>
                <Button
                  className="bg-gradient-to-tr from-indigo-500 to-indigo-300  text-white rounded-lg"
                  size="md"
                  variant="shadow"
                  onClick={endSession}
                >
                  End session
                </Button>
              </div>
            </div>
          ) : !isLoadingSession ? (
            <div className="h-full justify-center items-center flex flex-col gap-8 w-[500px] self-center">
              <div className="flex flex-col gap-2 w-full">
                <p className="text-sm font-medium leading-none">
                  Custom Knowledge ID (optional)
                </p>
                <Input
                  placeholder="Enter a custom knowledge ID"
                  value={knowledgeId}
                  onChange={(e) => setKnowledgeId(e.target.value)}
                />
                <p className="text-sm font-medium leading-none">
                  Custom Avatar ID (optional)
                </p>
                <Input
                  placeholder="Enter a custom avatar ID"
                  value={avatarId}
                  onChange={(e) => setAvatarId(e.target.value)}
                />
                <p className="text-sm font-medium leading-none">Language</p>
                <Select
                  placeholder="Select a language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {STT_LANGUAGE_LIST.map((lang) => (
                    <SelectItem key={lang.key} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <Button
                className="bg-gradient-to-tr from-indigo-500 to-indigo-300 text-white rounded-lg"
                size="lg"
                variant="shadow"
                onClick={startSession}
              >
                Start Session
              </Button>
            </div>
          ) : (
            <div className="h-full justify-center items-center flex flex-col gap-4">
              <Spinner size="lg" />
              <p className="text-sm text-default-500">Starting session...</p>
            </div>
          )}
        </CardBody>
      </Card>
      {stream && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div className="flex-1">
                <InteractiveAvatarTextInput
                  label="Text Input"
                  placeholder="Type your message..."
                  input={text}
                  onSubmit={handleSpeak}
                  setInput={setText}
                  loading={isLoadingRepeat}
                />
              </div>
              {speechSupported && (
                <Tooltip content={isListening ? "Stop listening" : "Start listening"}>
                  <Button
                    isIconOnly
                    color={isListening ? "danger" : "primary"}
                    variant="flat"
                    aria-label={isListening ? "Stop listening" : "Start listening"}
                    onClick={toggleListening}
                    className="ml-2"
                  >
                    {isListening ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
                  </Button>
                </Tooltip>
              )}
              <Switch
                isSelected={isAutoMode}
                onValueChange={setIsAutoMode}
                size="sm"
                className="ml-2"
              >
                Auto Mode
              </Switch>
            </div>
            {debug && (
              <p className="text-sm text-default-500">{debug}</p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
