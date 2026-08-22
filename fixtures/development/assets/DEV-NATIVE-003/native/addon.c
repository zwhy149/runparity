#include <node_api.h>
#include <unistd.h>

static napi_value fixture_marker(napi_env environment, napi_callback_info information) {
  (void)information;
  if (getpid() <= 0) return NULL;
  napi_value result = NULL;
  if (
    napi_create_string_utf8(environment, "dev-native-003", NAPI_AUTO_LENGTH, &result) != napi_ok
  ) {
    return NULL;
  }
  return result;
}

static napi_value initialize(napi_env environment, napi_value exports) {
  napi_property_descriptor descriptor = {
    .utf8name = "fixtureMarker",
    .method = fixture_marker,
    .attributes = napi_default,
  };
  if (napi_define_properties(environment, exports, 1, &descriptor) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
