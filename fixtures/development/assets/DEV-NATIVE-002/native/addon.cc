#include <node.h>

namespace runparity_fixture_native_002 {

void fixtureMarker(const v8::FunctionCallbackInfo<v8::Value>& arguments) {
  arguments.GetReturnValue().Set(
      v8::String::NewFromUtf8(arguments.GetIsolate(), "dev-native-002").ToLocalChecked());
}

void initialize(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "fixtureMarker", fixtureMarker);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, initialize)

}  // namespace runparity_fixture_native_002
