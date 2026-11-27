// SPDX-License-Identifier: GPL-3.0-or-later
// Original, standalone Vulkan 1.0 compute control; trusted synthetic shader only.
#include <vulkan/vulkan.h>
#include "nexusvi_vk_fixture.hpp"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>

static std::atomic<unsigned> errors{0};
static void check(VkResult result,const char* where){
    if(result!=VK_SUCCESS)throw std::runtime_error(std::string(where)+": "+std::to_string(result));
}
static void require(bool ok,const char* where){if(!ok)throw std::runtime_error(where);}
static VKAPI_ATTR VkBool32 VKAPI_CALL debug(VkDebugUtilsMessageSeverityFlagBitsEXT severity,
    VkDebugUtilsMessageTypeFlagsEXT,const VkDebugUtilsMessengerCallbackDataEXT* data,void*){
    if(severity&VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT){
        ++errors; std::cerr<<"validation: "<<(data&&data->pMessage?data->pMessage:"unknown")<<"\n";
    }
    return VK_FALSE;
}
template<class T> static T info(VkStructureType type){T t{};t.sType=type;return t;}
struct Session {
    VkInstance instance{}; VkDebugUtilsMessengerEXT messenger{}; VkDevice device{};
    VkCommandPool commands{}; VkFence fence{}; VkBuffer buffer{}; VkDeviceMemory memory{};
    VkDescriptorSetLayout set_layout{}; VkDescriptorPool descriptors{};
    VkPipelineLayout layout{}; VkShaderModule shader{}; VkPipeline pipeline{}; void* mapped{};
    Session()=default;Session(const Session&)=delete;Session& operator=(const Session&)=delete;
    ~Session(){
        if(device){
            if(mapped)vkUnmapMemory(device,memory);
            if(fence)vkDestroyFence(device,fence,nullptr);
            if(commands)vkDestroyCommandPool(device,commands,nullptr);
            if(pipeline)vkDestroyPipeline(device,pipeline,nullptr);
            if(shader)vkDestroyShaderModule(device,shader,nullptr);
            if(layout)vkDestroyPipelineLayout(device,layout,nullptr);
            if(descriptors)vkDestroyDescriptorPool(device,descriptors,nullptr);
            if(set_layout)vkDestroyDescriptorSetLayout(device,set_layout,nullptr);
            if(buffer)vkDestroyBuffer(device,buffer,nullptr);
            if(memory)vkFreeMemory(device,memory,nullptr);
            vkDestroyDevice(device,nullptr);
        }
        if(messenger){
            auto fn=reinterpret_cast<PFN_vkDestroyDebugUtilsMessengerEXT>(vkGetInstanceProcAddr(instance,"vkDestroyDebugUtilsMessengerEXT"));
            if(fn)fn(instance,messenger,nullptr);
        }
        if(instance)vkDestroyInstance(instance,nullptr);
    }
};
static std::vector<uint32_t> read_shader(const char* path){
    std::ifstream f(path,std::ios::binary|std::ios::ate);
    require(bool(f),"shader open");auto length=f.tellg();
    require(length>=20&&length<=1024*1024&&static_cast<std::streamoff>(length)%4==0,"shader length");
    std::vector<uint32_t> words(static_cast<size_t>(length)/4);
    f.seekg(0);f.read(reinterpret_cast<char*>(words.data()),static_cast<std::streamsize>(length));
    require(bool(f)&&words[0]==0x07230203u,"shader header");return words;
}
struct Result{uint32_t vendor,device,driver,api,type,heap;uint64_t allocation,heap_bytes,checks,dispatches;double wall_ms;};
static Result run(const std::vector<uint32_t>& code,const std::string& mode){
    require(mode=="software"||mode=="nvidia"||mode=="amd"||mode=="intel","unknown mode");
    const uint32_t vendor=mode=="nvidia"?0x10deu:mode=="amd"?0x1002u:mode=="intel"?0x8086u:0u;
    Session s;
    auto app=info<VkApplicationInfo>(VK_STRUCTURE_TYPE_APPLICATION_INFO);
    app.pApplicationName="NexusVI independent compute";app.apiVersion=VK_API_VERSION_1_0;
    auto dbg=info<VkDebugUtilsMessengerCreateInfoEXT>(VK_STRUCTURE_TYPE_DEBUG_UTILS_MESSENGER_CREATE_INFO_EXT);
    dbg.messageSeverity=VK_DEBUG_UTILS_MESSAGE_SEVERITY_ERROR_BIT_EXT;
    dbg.messageType=VK_DEBUG_UTILS_MESSAGE_TYPE_GENERAL_BIT_EXT|VK_DEBUG_UTILS_MESSAGE_TYPE_VALIDATION_BIT_EXT|VK_DEBUG_UTILS_MESSAGE_TYPE_PERFORMANCE_BIT_EXT;
    dbg.pfnUserCallback=debug;
    const char* layer="VK_LAYER_KHRONOS_validation";const char* ext=VK_EXT_DEBUG_UTILS_EXTENSION_NAME;
    auto ici=info<VkInstanceCreateInfo>(VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO);
    ici.pApplicationInfo=&app;ici.enabledLayerCount=1;ici.ppEnabledLayerNames=&layer;
    ici.enabledExtensionCount=1;ici.ppEnabledExtensionNames=&ext;ici.pNext=&dbg;
    check(vkCreateInstance(&ici,nullptr,&s.instance),"vkCreateInstance with validation");
    auto make_debug=reinterpret_cast<PFN_vkCreateDebugUtilsMessengerEXT>(vkGetInstanceProcAddr(s.instance,"vkCreateDebugUtilsMessengerEXT"));
    require(make_debug!=nullptr,"debug utils unavailable");
    check(make_debug(s.instance,&dbg,nullptr,&s.messenger),"debug messenger");
    uint32_t count=0;check(vkEnumeratePhysicalDevices(s.instance,&count,nullptr),"enumerate count");
    require(count>0&&count<=256,"device count");
    std::vector<VkPhysicalDevice> devices(count);check(vkEnumeratePhysicalDevices(s.instance,&count,devices.data()),"enumerate devices");
    VkPhysicalDevice physical{};uint32_t family=0;VkPhysicalDeviceProperties properties{};
    // Explicit mode; a driver-reported device type is not independent hardware verification.
    for(uint32_t d=0;d<count&&!physical;++d){
        VkPhysicalDeviceProperties p{};vkGetPhysicalDeviceProperties(devices[d],&p);
        if(mode=="software") { if(p.deviceType!=VK_PHYSICAL_DEVICE_TYPE_CPU)continue; }
        else if(p.vendorID!=vendor||(p.deviceType!=VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU&&p.deviceType!=VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU))continue;
        uint32_t n=0;vkGetPhysicalDeviceQueueFamilyProperties(devices[d],&n,nullptr);
        if(!n||n>1024)continue;
        std::vector<VkQueueFamilyProperties> queues(n);vkGetPhysicalDeviceQueueFamilyProperties(devices[d],&n,queues.data());
        for(uint32_t i=0;i<n;++i)if(queues[i].queueCount&&(queues[i].queueFlags&VK_QUEUE_COMPUTE_BIT)){
            physical=devices[d];family=i;properties=p;break;
        }
    }
    require(physical!=VK_NULL_HANDLE,"requested Vulkan compute device not found");
    require(properties.limits.maxComputeWorkGroupInvocations>=64&&properties.limits.maxComputeWorkGroupSize[0]>=64&&properties.limits.maxComputeWorkGroupCount[0]>=nv::groups(nv::capacity),"compute limits");
    constexpr VkDeviceSize bytes=nv::capacity*sizeof(uint32_t);
    require(properties.limits.maxStorageBufferRange>=bytes,"buffer limit");
    float priority=1;auto qi=info<VkDeviceQueueCreateInfo>(VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO);
    qi.queueFamilyIndex=family;qi.queueCount=1;qi.pQueuePriorities=&priority;
    auto di=info<VkDeviceCreateInfo>(VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO);di.queueCreateInfoCount=1;di.pQueueCreateInfos=&qi;
    check(vkCreateDevice(physical,&di,nullptr,&s.device),"logical device");
    VkQueue queue{};vkGetDeviceQueue(s.device,family,0,&queue);require(queue!=VK_NULL_HANDLE,"queue");
    auto bi=info<VkBufferCreateInfo>(VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO);
    bi.size=bytes;bi.usage=VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;bi.sharingMode=VK_SHARING_MODE_EXCLUSIVE;
    check(vkCreateBuffer(s.device,&bi,nullptr,&s.buffer),"storage buffer");
    VkMemoryRequirements req{};vkGetBufferMemoryRequirements(s.device,s.buffer,&req);
    VkPhysicalDeviceMemoryProperties mem{};vkGetPhysicalDeviceMemoryProperties(physical,&mem);
    std::vector<uint32_t> flags;for(uint32_t i=0;i<mem.memoryTypeCount;++i)flags.push_back(mem.memoryTypes[i].propertyFlags);
    auto mt=nv::memory_type(req.memoryTypeBits,flags,VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT|VK_MEMORY_PROPERTY_HOST_COHERENT_BIT);
    auto heap=mem.memoryTypes[mt].heapIndex;require(heap<mem.memoryHeapCount&&req.size<=mem.memoryHeaps[heap].size,"memory capacity");
    auto ai=info<VkMemoryAllocateInfo>(VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO);ai.allocationSize=req.size;ai.memoryTypeIndex=mt;
    check(vkAllocateMemory(s.device,&ai,nullptr,&s.memory),"memory allocation");
    check(vkBindBufferMemory(s.device,s.buffer,s.memory,0),"memory binding");
    check(vkMapMemory(s.device,s.memory,0,bytes,0,&s.mapped),"map memory");
    VkDescriptorSetLayoutBinding binding{};binding.binding=0;binding.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    binding.descriptorCount=1;binding.stageFlags=VK_SHADER_STAGE_COMPUTE_BIT;
    auto sli=info<VkDescriptorSetLayoutCreateInfo>(VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO);
    sli.bindingCount=1;sli.pBindings=&binding;
    check(vkCreateDescriptorSetLayout(s.device,&sli,nullptr,&s.set_layout),"descriptor layout");
    VkDescriptorPoolSize ps{VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,1};
    auto dpi=info<VkDescriptorPoolCreateInfo>(VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO);
    dpi.maxSets=1;dpi.poolSizeCount=1;dpi.pPoolSizes=&ps;
    check(vkCreateDescriptorPool(s.device,&dpi,nullptr,&s.descriptors),"descriptor pool");
    auto dsi=info<VkDescriptorSetAllocateInfo>(VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO);
    dsi.descriptorPool=s.descriptors;dsi.descriptorSetCount=1;dsi.pSetLayouts=&s.set_layout;
    VkDescriptorSet set{};check(vkAllocateDescriptorSets(s.device,&dsi,&set),"descriptor set");
    VkDescriptorBufferInfo db{s.buffer,0,bytes};
    auto wr=info<VkWriteDescriptorSet>(VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET);
    wr.dstSet=set;wr.descriptorCount=1;wr.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;wr.pBufferInfo=&db;
    vkUpdateDescriptorSets(s.device,1,&wr,0,nullptr);
    VkPushConstantRange push{VK_SHADER_STAGE_COMPUTE_BIT,0,sizeof(uint32_t)};
    auto pli=info<VkPipelineLayoutCreateInfo>(VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO);
    pli.setLayoutCount=1;pli.pSetLayouts=&s.set_layout;pli.pushConstantRangeCount=1;pli.pPushConstantRanges=&push;
    check(vkCreatePipelineLayout(s.device,&pli,nullptr,&s.layout),"pipeline layout");
    auto sm=info<VkShaderModuleCreateInfo>(VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO);sm.codeSize=code.size()*4;sm.pCode=code.data();
    check(vkCreateShaderModule(s.device,&sm,nullptr,&s.shader),"shader module");
    auto stage=info<VkPipelineShaderStageCreateInfo>(VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO);
    stage.stage=VK_SHADER_STAGE_COMPUTE_BIT;stage.module=s.shader;stage.pName="main";
    auto pi=info<VkComputePipelineCreateInfo>(VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO);pi.stage=stage;pi.layout=s.layout;
    check(vkCreateComputePipelines(s.device,VK_NULL_HANDLE,1,&pi,nullptr,&s.pipeline),"compute pipeline");
    auto cpi=info<VkCommandPoolCreateInfo>(VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO);
    cpi.flags=VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;cpi.queueFamilyIndex=family;
    check(vkCreateCommandPool(s.device,&cpi,nullptr,&s.commands),"command pool");
    auto cai=info<VkCommandBufferAllocateInfo>(VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO);
    cai.commandPool=s.commands;cai.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY;cai.commandBufferCount=1;
    VkCommandBuffer cmd{};check(vkAllocateCommandBuffers(s.device,&cai,&cmd),"command buffer");
    auto fi=info<VkFenceCreateInfo>(VK_STRUCTURE_TYPE_FENCE_CREATE_INFO);
    check(vkCreateFence(s.device,&fi,nullptr,&s.fence),"fence");
    auto* data=static_cast<uint32_t*>(s.mapped);uint64_t checks=0,dispatches=0;
    auto start=std::chrono::steady_clock::now();
    for(uint32_t repeat=0;repeat<20;++repeat)for(uint32_t n:nv::sizes){
        uint32_t seed=0xffffffffu-repeat;
        for(uint32_t i=0;i<nv::capacity;++i)data[i]=nv::initial(i,seed);
        check(vkResetCommandBuffer(cmd,0),"reset command buffer");
        auto begin=info<VkCommandBufferBeginInfo>(VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO);
        begin.flags=VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        check(vkBeginCommandBuffer(cmd,&begin),"begin command buffer");
        auto barrier=info<VkBufferMemoryBarrier>(VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER);
        barrier.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT;
        barrier.srcQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;barrier.dstQueueFamilyIndex=VK_QUEUE_FAMILY_IGNORED;
        barrier.buffer=s.buffer;barrier.size=bytes;
        vkCmdPipelineBarrier(cmd,VK_PIPELINE_STAGE_HOST_BIT,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,0,0,nullptr,1,&barrier,0,nullptr);
        vkCmdBindPipeline(cmd,VK_PIPELINE_BIND_POINT_COMPUTE,s.pipeline);
        vkCmdBindDescriptorSets(cmd,VK_PIPELINE_BIND_POINT_COMPUTE,s.layout,0,1,&set,0,nullptr);
        vkCmdPushConstants(cmd,s.layout,VK_SHADER_STAGE_COMPUTE_BIT,0,sizeof(n),&n);
        vkCmdDispatch(cmd,nv::groups(n),1,1);
        barrier.srcAccessMask=VK_ACCESS_SHADER_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_HOST_READ_BIT;
        vkCmdPipelineBarrier(cmd,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,0,nullptr,1,&barrier,0,nullptr);
        check(vkEndCommandBuffer(cmd),"end command buffer");
        check(vkResetFences(s.device,1,&s.fence),"reset fence");
        auto submit=info<VkSubmitInfo>(VK_STRUCTURE_TYPE_SUBMIT_INFO);submit.commandBufferCount=1;submit.pCommandBuffers=&cmd;
        check(vkQueueSubmit(queue,1,&submit,s.fence),"submit");
        auto waited=vkWaitForFences(s.device,1,&s.fence,VK_TRUE,2000000000ull);
        // On failed wait, avoid destroying potentially in-flight resources.
        if(waited!=VK_SUCCESS){std::cerr<<"fence wait: "<<waited<<"\n";std::quick_exit(2);}
        for(uint32_t i=0;i<nv::capacity;++i){
            require(data[i]==nv::expected(i,n,seed),"compute or guard mismatch");++checks;
        }
        ++dispatches;
    }
    auto wall=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
    return {properties.vendorID,properties.deviceID,properties.driverVersion,properties.apiVersion,
        static_cast<uint32_t>(properties.deviceType),heap,req.size,mem.memoryHeaps[heap].size,checks,dispatches,wall};
}
int main(int argc,char** argv){
    try{
        require(argc==2||argc==3,"usage: nexusvi_vk_compute trusted-validated.spv [software|nvidia|amd|intel]");
        auto result=run(read_shader(argv[1]),argc==3?argv[2]:"software");
        require(errors.load()==0,"validation errors");
        std::cout<<"{\"scope\":\"independent_vulkan_compute\",\"vendor_id\":"<<result.vendor
            <<",\"device_id\":"<<result.device<<",\"driver_version\":"<<result.driver<<",\"api_version\":"<<result.api
            <<",\"device_type\":"<<result.type<<",\"heap_index\":"<<result.heap
            <<",\"allocation_bytes\":"<<result.allocation<<",\"heap_capacity_bytes\":"<<result.heap_bytes
            <<",\"dispatches\":"<<result.dispatches<<",\"values_checked\":"<<result.checks
            <<",\"validation_errors\":0,\"wall_ms\":"<<result.wall_ms<<",\"physical_gpu_verified\":false}\n";
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
