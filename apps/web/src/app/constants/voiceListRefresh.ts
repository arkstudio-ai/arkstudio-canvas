/**
 * 跨组件刷新自定义音色列表的信号名。
 * SecondaryVoiceList / useVoiceOptions 监听；需要刷新时可 dispatch 同名 CustomEvent。
 */
export const VOICE_LIST_REFRESH_EVENT = 'voice-list-refresh';
